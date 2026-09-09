import * as p from "@clack/prompts";
import type { KanboardApi } from "./kanboard.js";
import { toKanboardId } from "./kanboard.js";
import type { Plan, PlanAction } from "./planner.js";
import { describeAction } from "./planner.js";
import { findColumnId } from "./columns.js";

interface ApplyContext {
    projectId: number | null;
    columnIds: Map<string, number>;
    taskIds: Map<string, number>;
}

export async function applyPlan(kanboard: KanboardApi, plan: Plan): Promise<number> {
    return applyPlanWithReporter(kanboard, plan, "clack");
}

export async function applyPlanWithReporter(
    kanboard: KanboardApi,
    plan: Plan,
    reporter: ApplyReporter = "clack",
): Promise<number> {
    const context: ApplyContext = {
        projectId: plan.projectId,
        columnIds: new Map(plan.columnIds),
        taskIds: new Map(plan.taskIds),
    };
    let completed = 0;

    for (const action of plan.actions) {
        const description = describeAction(action, plan.manifest);
        const spinner = reporter === "clack" ? p.spinner() : null;
        spinner?.start(description);
        try {
            const result = await executeAction(kanboard, plan, context, action);
            spinner?.stop(result);
            if (typeof reporter === "function") reporter({ action, description, status: "success", message: result });
            completed += 1;
        } catch (error) {
            spinner?.error(`Failed: ${description}`);
            if (typeof reporter === "function") reporter({ action, description, status: "failed", error });
            throw new ApplyError(description, error, completed);
        }
    }
    return completed;
}

export type ApplyReporter = "clack" | ((event: ApplyEvent) => void);

export interface ApplyEvent {
    action: PlanAction;
    description: string;
    status: "success" | "failed";
    message?: string;
    error?: unknown;
}

async function executeAction(
    kanboard: KanboardApi,
    plan: Plan,
    context: ApplyContext,
    action: PlanAction,
): Promise<string> {
    switch (action.type) {
        case "create-project": {
            context.projectId = await kanboard.createProject(plan.manifest.project);
            for (const column of await kanboard.getColumns(context.projectId)) {
                context.columnIds.set(column.title, toKanboardId(column.id));
            }
            return `Created project ${plan.manifest.project.identifier}`;
        }
        case "ensure-column": {
            const existingColumnId = findColumnId(context.columnIds, action.title);
            if (existingColumnId !== undefined) {
                context.columnIds.set(action.title, existingColumnId);
                return `Reused column ${action.title}`;
            }
            const id = await kanboard.addColumn(requireProjectId(context), action.title);
            context.columnIds.set(action.title, id);
            return `Created column ${action.title}`;
        }
        case "create-task": {
            const task = requireTaskDefinition(plan, action.taskKey);
            const columnId = findColumnId(context.columnIds, task.column);
            if (columnId === undefined) throw new Error(`Column \"${task.column}\" has no resolved ID`);
            const id = await kanboard.createTask({
                projectId: requireProjectId(context),
                columnId,
                title: task.title,
                reference: task.reference,
                description: task.description,
                due: task.due,
                ownerId: task.assignee
                    ? plan.userIds.get(task.assignee)
                    : plan.defaultAssigneeId,
            });
            context.taskIds.set(task.id, id);
            return `Created task ${task.reference}`;
        }
        case "create-subtask": {
            const task = requireTaskDefinition(plan, action.taskKey);
            await kanboard.createSubtask(requireTaskId(context, action.taskKey), action.title);
            return `Created subtask under ${task.reference}: ${action.title}`;
        }
        case "create-dependency": {
            const task = requireTaskDefinition(plan, action.taskKey);
            const dependency = requireTaskDefinition(plan, action.dependencyKey);
            await kanboard.createTaskLink(
                requireTaskId(context, action.taskKey),
                requireTaskId(context, action.dependencyKey),
                plan.blockedByLinkId,
            );
            return `Linked ${task.reference} after ${dependency.reference}`;
        }
        case "position-task": {
            const task = requireTaskDefinition(plan, action.taskKey);
            const projectId = requireProjectId(context);
            const taskId = requireTaskId(context, action.taskKey);
            const columnId = findColumnId(context.columnIds, action.column);
            if (columnId === undefined) throw new Error(`Column \"${action.column}\" has no resolved ID`);

            if (await isTaskInTargetPlace(kanboard, projectId, task.reference, taskId, columnId, action.position)) {
                return `Task ${task.reference} already positioned`;
            }

            const moved = await kanboard.moveTaskPosition(
                projectId,
                taskId,
                columnId,
                action.position,
                plan.defaultSwimlaneId,
            );
            if (!moved) {
                if (await isTaskInTargetPlace(kanboard, projectId, task.reference, taskId, columnId, action.position)) {
                    return `Task ${task.reference} already positioned`;
                }
                throw new Error("Kanboard could not move the task");
            }
            return `Positioned ${task.reference}`;
        }
    }
}

async function isTaskInTargetPlace(
    kanboard: KanboardApi,
    projectId: number,
    reference: string,
    taskId: number,
    columnId: number,
    position: number,
): Promise<boolean> {
    const current = await kanboard.getTaskByReference(projectId, reference);
    if (!current || toKanboardId(current.id, `Task ${reference} ID`) !== taskId) {
        return false;
    }

    if (toKanboardId(current.column_id, `Task ${reference} column ID`) !== columnId) {
        return false;
    }

    const currentPosition = Number(current.position);
    return currentPosition === position || currentPosition === position - 1;
}

function requireProjectId(context: ApplyContext): number {
    if (context.projectId === null) throw new Error("Project ID is unresolved");
    return context.projectId;
}

function requireTaskId(context: ApplyContext, taskKey: string): number {
    const id = context.taskIds.get(taskKey);
    if (id === undefined) throw new Error(`Task \"${taskKey}\" has no resolved ID`);
    return id;
}

function requireTaskDefinition(plan: Plan, taskKey: string) {
    const task = plan.manifest.tasks.find(candidate => candidate.id === taskKey);
    if (!task) throw new Error(`Task definition \"${taskKey}\" is missing`);
    return task;
}

export class ApplyError extends Error {
    constructor(
        public readonly action: string,
        public readonly cause: unknown,
        public readonly completed: number,
    ) {
        super(`Apply stopped after ${completed} completed actions while attempting: ${action}`);
        this.name = "ApplyError";
    }
}
