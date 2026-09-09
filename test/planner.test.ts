import assert from "node:assert/strict";
import test from "node:test";
import { applyPlan } from "../src/applyPlan.js";
import type {
    CreateProjectOptions,
    CreateTaskOptions,
    KanboardApi,
    KanboardColumn,
    KanboardLinkType,
    KanboardProject,
    KanboardSubtask,
    KanboardSwimlane,
    KanboardTask,
    KanboardTaskLink,
    KanboardUser,
} from "../src/kanboard.js";
import { buildPlan, PlanError } from "../src/planner.js";
import type { Plan } from "../src/planner.js";
import { ProjectSchema } from "../src/schema.js";

const manifest = ProjectSchema.parse({
    version: 1,
    project: {
        identifier: "TESTBOARD",
        name: "Test board",
        description: "",
    },
    columns: ["Backlog", "Done"],
    tasks: [{
        id: "first-task",
        reference: "TEST-001",
        title: "First task",
        column: "Backlog",
        assignee: "walker",
        subtasks: ["First subtask"],
    }],
});

test("plans a complete new board without mutating Kanboard", async () => {
    const api = new FakeKanboard();
    const plan = await buildPlan(api, manifest, "abc123");
    assert.deepEqual(plan.actions.map(action => action.type), [
        "create-project",
        "ensure-column",
        "ensure-column",
        "create-task",
        "create-subtask",
        "position-task",
    ]);
    assert.equal(api.writeCalls, 0);
});

test("returns an empty plan when the board already matches", async () => {
    const api = new FakeKanboard({ existing: true });
    const plan = await buildPlan(api, manifest, "abc123");
    assert.deepEqual(plan.actions, []);
    assert.equal(api.writeCalls, 0);
});

test("uses the authenticated user as the default assignee", async () => {
    const api = new FakeKanboard();
    const withoutAssignee = ProjectSchema.parse({
        ...manifest,
        tasks: manifest.tasks.map(({ assignee: _assignee, ...task }) => task),
    });
    const plan = await buildPlan(api, withoutAssignee, "abc123");
    assert.equal(plan.defaultAssigneeId, 2);
});

test("identifies a missing task assignee", async () => {
    const api = new FakeKanboard({ missingUser: true });
    const withMissingAssignee = ProjectSchema.parse({
        ...manifest,
        tasks: manifest.tasks.map(task => ({ ...task, assignee: "missing-user" })),
    });
    await assert.rejects(
        buildPlan(api, withMissingAssignee, "abc123"),
        (error: unknown) => error instanceof PlanError &&
            error.message ===
                'Task assignee "missing-user" does not exist in Kanboard (referenced by TEST-001)',
    );
    assert.equal(api.writeCalls, 0);
});

class FakeKanboard implements KanboardApi {
    writeCalls = 0;
    constructor(private readonly options: {
        existing?: boolean;
        missingUser?: boolean;
    } = {}) {}

    async getVersion(): Promise<string> { return "1.2.54"; }
    async getMe(): Promise<KanboardUser | null> {
        return { id: "2", username: "walker" };
    }
    async getProjectByIdentifier(): Promise<KanboardProject | null> {
        return this.options.existing ? {
            id: "1", name: "Test board", identifier: "TESTBOARD",
            description: "", is_active: "1",
        } : null;
    }
    async getColumns(): Promise<KanboardColumn[]> {
        return this.options.existing ? [
            { id: "1", title: "Backlog", position: "1" },
            { id: "2", title: "Done", position: "2" },
        ] : [];
    }
    async getTaskByReference(): Promise<KanboardTask | null> {
        return this.options.existing ? {
            id: "10", title: "First task", description: "", reference: "TEST-001",
            column_id: "1", owner_id: "2", position: "1", swimlane_id: "0",
        } : null;
    }
    async getSubtasks(): Promise<KanboardSubtask[]> {
        return this.options.existing ? [{ id: "20", title: "First subtask" }] : [];
    }
    async getTaskLinks(): Promise<KanboardTaskLink[]> { return []; }
    async getLinkByLabel(): Promise<KanboardLinkType | null> {
        return { id: "3", label: "is blocked by" };
    }
    async getUserByName(): Promise<KanboardUser | null> {
        return this.options.missingUser
            ? null
            : { id: "2", username: "walker" };
    }
    async getActiveSwimlanes(): Promise<KanboardSwimlane[]> {
        return [{ id: 0, name: "Default swimlane" }];
    }

    async createProject(_options: CreateProjectOptions): Promise<number> {
        this.writeCalls += 1; return 1;
    }
    async addColumn(_projectId: number, _title: string): Promise<number> {
        this.writeCalls += 1; return 1;
    }
    async createTask(_options: CreateTaskOptions): Promise<number> {
        this.writeCalls += 1; return 1;
    }
    async createSubtask(_taskId: number, _title: string): Promise<number> {
        this.writeCalls += 1; return 1;
    }
    async createTaskLink(
        _taskId: number,
        _oppositeTaskId: number,
        _linkId: number,
    ): Promise<number> {
        this.writeCalls += 1; return 1;
    }
    async moveTaskPosition(
        _projectId: number,
        _taskId: number,
        _columnId: number,
        _position: number,
        _swimlaneId: number,
    ): Promise<void> {
        this.writeCalls += 1;
    }
}

test("skips a positioning call when the task is already in place", async () => {
    const api = new NoOpPositionKanboard();
    const plan: Plan = {
        manifest,
        manifestHash: "abc123",
        projectId: 1,
        columnIds: new Map([["Backlog", 1], ["Done", 2]]),
        taskIds: new Map([["first-task", 10]]),
        userIds: new Map([["walker", 2]]),
        defaultAssigneeId: 2,
        blockedByLinkId: 3,
        defaultSwimlaneId: 0,
        actions: [{
            type: "position-task",
            taskKey: "first-task",
            column: "Backlog",
            position: 1,
        }],
    };

    assert.equal(await applyPlan(api, plan), 1);
    assert.equal(api.moveCalls, 0);
});

class NoOpPositionKanboard extends FakeKanboard {
    moveCalls = 0;

    override async getTaskByReference(): Promise<KanboardTask | null> {
        return {
            id: "10",
            title: "First task",
            description: "",
            reference: "TEST-001",
            column_id: "1",
            owner_id: "2",
            position: "1",
            swimlane_id: "0",
        };
    }

    override async moveTaskPosition(): Promise<void> {
        this.moveCalls += 1;
    }
}
