import type { KanboardApi, KanboardTask } from "./kanboard.js";
import { toKanboardId } from "./kanboard.js";
import type { ProjectDefinition } from "./schema.js";

export type PlanAction =
    | { type: "create-project" }
    | { type: "ensure-column"; title: string }
    | { type: "create-task"; taskKey: string }
    | { type: "create-subtask"; taskKey: string; title: string }
    | { type: "create-dependency"; taskKey: string; dependencyKey: string }
    | { type: "position-task"; taskKey: string; column: string; position: number };

export interface Plan {
    manifest: ProjectDefinition;
    manifestHash: string;
    projectId: number | null;
    columnIds: Map<string, number>;
    taskIds: Map<string, number>;
    userIds: Map<string, number>;
    blockedByLinkId: number;
    defaultSwimlaneId: number;
    actions: PlanAction[];
}

export async function buildPlan(
    kanboard: KanboardApi,
    manifest: ProjectDefinition,
    manifestHash: string,
): Promise<Plan> {
    const project = await kanboard.getProjectByIdentifier(manifest.project.identifier);
    const projectId = project ? toKanboardId(project.id, "Project ID") : null;
    const actions: PlanAction[] = project ? [] : [{ type: "create-project" }];
    const columnIds = new Map<string, number>();
    const existingTasks = new Map<string, KanboardTask>();
    const taskIds = new Map<string, number>();
    let defaultSwimlaneId = 0;

    if (projectId !== null) {
        const [columns, swimlanes] = await Promise.all([
            kanboard.getColumns(projectId),
            kanboard.getActiveSwimlanes(projectId),
        ]);
        for (const column of columns) {
            columnIds.set(column.title, toKanboardId(column.id, `Column ${column.title} ID`));
        }
        const defaultSwimlane = swimlanes.find(swimlane => Number(swimlane.id) === 0);
        defaultSwimlaneId = defaultSwimlane
            ? toKanboardId(defaultSwimlane.id, "Default swimlane ID")
            : swimlanes.length > 0
                ? toKanboardId(swimlanes[0]!.id, "Active swimlane ID")
                : 0;
    }

    for (const title of manifest.columns) {
        if (projectId === null || !columnIds.has(title)) {
            actions.push({ type: "ensure-column", title });
        }
    }

    const userIds = await resolveAssignees(kanboard, manifest);

    if (projectId !== null) {
        const resolvedTasks = await Promise.all(
            manifest.tasks.map(task => kanboard.getTaskByReference(projectId, task.reference)),
        );
        resolvedTasks.forEach((task, index) => {
            if (!task) return;
            const definition = manifest.tasks[index]!;
            existingTasks.set(definition.id, task);
            taskIds.set(definition.id, toKanboardId(task.id, `Task ${definition.reference} ID`));
        });
    }

    for (const task of manifest.tasks) {
        if (!taskIds.has(task.id)) actions.push({ type: "create-task", taskKey: task.id });
    }

    for (const task of manifest.tasks) {
        const taskId = taskIds.get(task.id);
        const existingTitles = taskId === undefined
            ? new Set<string>()
            : new Set((await kanboard.getSubtasks(taskId)).map(subtask => subtask.title));
        for (const title of task.subtasks) {
            if (!existingTitles.has(title)) {
                actions.push({ type: "create-subtask", taskKey: task.id, title });
            }
        }
    }

    const blockedBy = await kanboard.getLinkByLabel("is blocked by");
    if (!blockedBy) throw new PlanError("Kanboard link type \"is blocked by\" is unavailable");
    const blockedByLinkId = toKanboardId(blockedBy.id, "Blocked-by link ID");

    for (const task of manifest.tasks) {
        const taskId = taskIds.get(task.id);
        const existingLinks = taskId === undefined ? [] : await kanboard.getTaskLinks(taskId);
        for (const dependencyKey of task.depends_on) {
            const dependencyId = taskIds.get(dependencyKey);
            const exists = dependencyId !== undefined && existingLinks.some(link =>
                toKanboardId(link.task_id, "Linked task ID") === dependencyId &&
                link.label.toLowerCase() === "is blocked by"
            );
            if (!exists) {
                actions.push({ type: "create-dependency", taskKey: task.id, dependencyKey });
            }
        }
    }

    addPositionActions(actions, manifest, existingTasks, columnIds, defaultSwimlaneId);
    return {
        manifest,
        manifestHash,
        projectId,
        columnIds,
        taskIds,
        userIds,
        blockedByLinkId,
        defaultSwimlaneId,
        actions,
    };
}

export function describeAction(action: PlanAction, manifest: ProjectDefinition): string {
    const task = "taskKey" in action
        ? manifest.tasks.find(candidate => candidate.id === action.taskKey)
        : undefined;
    switch (action.type) {
        case "create-project": return `Create project ${manifest.project.identifier}`;
        case "ensure-column": return `Ensure column ${action.title}`;
        case "create-task": return `Create task ${task?.reference ?? action.taskKey}`;
        case "create-subtask":
            return `Create subtask under ${task?.reference ?? action.taskKey}: ${action.title}`;
        case "create-dependency": {
            const dependency = manifest.tasks.find(candidate => candidate.id === action.dependencyKey);
            return `Link ${task?.reference ?? action.taskKey} after ${dependency?.reference ?? action.dependencyKey}`;
        }
        case "position-task":
            return `Position ${task?.reference ?? action.taskKey} in ${action.column} at ${action.position}`;
    }
}

async function resolveAssignees(
    kanboard: KanboardApi,
    manifest: ProjectDefinition,
): Promise<Map<string, number>> {
    const usernames = [...new Set(
        manifest.tasks.flatMap(task => task.assignee ? [task.assignee] : []),
    )];
    const userIds = new Map<string, number>();
    for (const username of usernames) {
        const user = await kanboard.getUserByName(username);
        if (!user) {
            const tasks = manifest.tasks
                .filter(task => task.assignee === username)
                .map(task => task.reference)
                .join(", ");
            throw new PlanError(
                `Task assignee \"${username}\" does not exist in Kanboard (referenced by ${tasks})`,
            );
        }
        userIds.set(username, toKanboardId(user.id, `User ${username} ID`));
    }
    return userIds;
}

function addPositionActions(
    actions: PlanAction[],
    manifest: ProjectDefinition,
    existingTasks: Map<string, KanboardTask>,
    columnIds: Map<string, number>,
    defaultSwimlaneId: number,
): void {
    for (const column of manifest.columns) {
        const tasks = manifest.tasks.filter(task => task.column === column);
        if (tasks.length === 0) continue;
        const columnId = columnIds.get(column);
        const needsOrdering = tasks.some((task, index) => {
            const existing = existingTasks.get(task.id);
            return !existing ||
                columnId === undefined ||
                toKanboardId(existing.column_id, "Task column ID") !== columnId ||
                Number(existing.position) !== index + 1 ||
                toKanboardId(existing.swimlane_id, "Task swimlane ID") !== defaultSwimlaneId;
        });
        if (!needsOrdering) continue;
        tasks.forEach((task, index) => actions.push({
            type: "position-task",
            taskKey: task.id,
            column,
            position: index + 1,
        }));
    }
}

export class PlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PlanError";
    }
}
