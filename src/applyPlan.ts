import * as p from "@clack/prompts";
import type { KanboardApi } from "./kanboard.js";
import { toKanboardId } from "./kanboard.js";
import type { Plan, PlanAction } from "./planner.js";
import { describeAction } from "./planner.js";

interface ApplyContext {
    projectId: number | null;
    columnIds: Map<string, number>;
    taskIds: Map<string, number>;
}

export async function applyPlan(kanboard: KanboardApi, plan: Plan): Promise<number> {
    const context: ApplyContext = {
        projectId: plan.projectId,
        columnIds: new Map(plan.columnIds),
        taskIds: new Map(plan.taskIds),
    };
    let completed = 0;

    for (const action of plan.actions) {
        const spinner = p.spinner();
        const description = describeAction(action, plan.manifest);
        spinner.start(description);
        try {
            spinner.stop(await executeAction(kanboard, plan, context, action));
            completed += 1;
        } catch (error) {
            spinner.error(`Failed: ${description}`);
            throw new ApplyError(description, error, completed);
        }
    }
    return completed;
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
            if (context.columnIds.has(action.title)) return `Reused column ${action.title}`;
            const id = await kanboard.addColumn(requireProjectId(context), action.title);
            context.columnIds.set(action.title, id);
            return `Created column ${action.title}`;
        }
        case "create-task": {
            const task = requireTaskDefinition(plan, action.taskKey);
            const columnId = context.columnIds.get(task.column);
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
            const columnId = context.columnIds.get(action.column);
            if (columnId === undefined) throw new Error(`Column \"${action.column}\" has no resolved ID`);
            await kanboard.moveTaskPosition(
                requireProjectId(context),
                requireTaskId(context, action.taskKey),
                columnId,
                action.position,
                plan.defaultSwimlaneId,
            );
            return `Positioned ${task.reference}`;
        }
    }
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
