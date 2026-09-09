export interface KanboardOptions {
    url: string;
    username: string;
    apiKey: string;
}

export interface KanboardProject {
    id: string;
    name: string;
    identifier: string;
    description: string;
    is_active: string;
    url?: string;
}

export interface KanboardColumn {
    id: string;
    title: string;
    position: string;
}

export interface KanboardTask {
    id: string;
    title: string;
    description: string;
    reference: string;
    column_id: string;
    owner_id: string;
    position: string;
    swimlane_id: string;
}

export interface KanboardSubtask { id: string; title: string; }
export interface KanboardTaskLink { task_id: string; label: string; }
export interface KanboardLinkType { id: string; label: string; }
export interface KanboardUser { id: string | number; username: string; name?: string | null; }
export interface KanboardSwimlane { id: string | number; name: string; }

export interface CreateProjectOptions {
    name: string;
    identifier: string;
    description?: string;
}

export interface CreateTaskOptions {
    projectId: number;
    columnId: number;
    title: string;
    reference: string;
    description?: string;
    due?: string;
    ownerId?: number;
}

interface JsonRpcResponse<T> {
    jsonrpc: "2.0";
    id: number;
    result?: T;
    error?: { code: number; message: string; data?: unknown; };
}

export interface KanboardApi {
    getVersion(): Promise<string>;
    getMe(): Promise<KanboardUser | null>;
    getProjectByIdentifier(identifier: string): Promise<KanboardProject | null>;
    createProject(options: CreateProjectOptions): Promise<number>;
    getColumns(projectId: number): Promise<KanboardColumn[]>;
    addColumn(projectId: number, title: string): Promise<number>;
    getTaskByReference(projectId: number, reference: string): Promise<KanboardTask | null>;
    createTask(options: CreateTaskOptions): Promise<number>;
    getSubtasks(taskId: number): Promise<KanboardSubtask[]>;
    createSubtask(taskId: number, title: string): Promise<number>;
    getTaskLinks(taskId: number): Promise<KanboardTaskLink[]>;
    createTaskLink(taskId: number, oppositeTaskId: number, linkId: number): Promise<number>;
    getLinkByLabel(label: string): Promise<KanboardLinkType | null>;
    getUserByName(username: string): Promise<KanboardUser | null>;
    getActiveSwimlanes(projectId: number): Promise<KanboardSwimlane[]>;
    moveTaskPosition(
        projectId: number,
        taskId: number,
        columnId: number,
        position: number,
        swimlaneId: number,
    ): Promise<boolean>;
}

export class Kanboard implements KanboardApi {
    private readonly endpoint: string;
    private readonly authorization: string;
    private requestId = 0;

    constructor(options: KanboardOptions) {
        this.endpoint = normalizeEndpoint(options.url);
        this.authorization = `Basic ${Buffer.from(
            `${options.username}:${options.apiKey}`,
            "utf8",
        ).toString("base64")}`;
    }

    getVersion(): Promise<string> {
        return this.request<string>("getVersion");
    }

    async getMe(): Promise<KanboardUser | null> {
        return await this.request<KanboardUser | false | null>("getMe") || null;
    }

    getProjects(): Promise<KanboardProject[]> {
        return this.request<KanboardProject[]>("getMyProjects");
    }

    async getProjectByIdentifier(identifier: string): Promise<KanboardProject | null> {
        return await this.request<KanboardProject | false | null>(
            "getProjectByIdentifier",
            { identifier },
        ) || null;
    }

    async createProject(options: CreateProjectOptions): Promise<number> {
        return this.requireCreatedId(
            await this.request<number | false>("createProject", {
                name: options.name,
                identifier: options.identifier,
                description: options.description ?? "",
            }),
            `create project "${options.name}"`,
        );
    }

    getColumns(projectId: number): Promise<KanboardColumn[]> {
        return this.request<KanboardColumn[]>("getColumns", { project_id: projectId });
    }

    async addColumn(projectId: number, title: string): Promise<number> {
        return this.requireCreatedId(
            await this.request<number | false>("addColumn", {
                project_id: projectId,
                title,
            }),
            `create column "${title}"`,
        );
    }

    async getTaskByReference(projectId: number, reference: string): Promise<KanboardTask | null> {
        return await this.request<KanboardTask | false | null>(
            "getTaskByReference",
            { project_id: projectId, reference },
        ) || null;
    }

    async createTask(options: CreateTaskOptions): Promise<number> {
        return this.requireCreatedId(
            await this.request<number | false>("createTask", {
                project_id: options.projectId,
                column_id: options.columnId,
                title: options.title,
                reference: options.reference,
                description: options.description ?? "",
                date_due: options.due ?? "",
                ...(options.ownerId === undefined ? {} : { owner_id: options.ownerId }),
            }),
            `create task "${options.reference}"`,
        );
    }

    async getSubtasks(taskId: number): Promise<KanboardSubtask[]> {
        return await this.request<KanboardSubtask[] | false>("getAllSubtasks", {
            task_id: taskId,
        }) || [];
    }

    async createSubtask(taskId: number, title: string): Promise<number> {
        return this.requireCreatedId(
            await this.request<number | false>("createSubtask", {
                task_id: taskId,
                title,
            }),
            `create subtask "${title}"`,
        );
    }

    async getTaskLinks(taskId: number): Promise<KanboardTaskLink[]> {
        return await this.request<KanboardTaskLink[] | false>("getAllTaskLinks", {
            task_id: taskId,
        }) || [];
    }

    async createTaskLink(taskId: number, oppositeTaskId: number, linkId: number): Promise<number> {
        return this.requireCreatedId(
            await this.request<number | false>("createTaskLink", {
                task_id: taskId,
                opposite_task_id: oppositeTaskId,
                link_id: linkId,
            }),
            "create task dependency",
        );
    }

    async getLinkByLabel(label: string): Promise<KanboardLinkType | null> {
        return await this.request<KanboardLinkType | false | null>(
            "getLinkByLabel",
            { label },
        ) || null;
    }

    async getUserByName(username: string): Promise<KanboardUser | null> {
        return await this.request<KanboardUser | false | null>(
            "getUserByName",
            { username },
        ) || null;
    }

    async getActiveSwimlanes(projectId: number): Promise<KanboardSwimlane[]> {
        return await this.request<KanboardSwimlane[] | null>("getActiveSwimlanes", {
            project_id: projectId,
        }) ?? [];
    }

    async moveTaskPosition(
        projectId: number,
        taskId: number,
        columnId: number,
        position: number,
        swimlaneId: number,
    ): Promise<boolean> {
        return await this.request<boolean>("moveTaskPosition", {
            project_id: projectId,
            task_id: taskId,
            column_id: columnId,
            position,
            swimlane_id: swimlaneId,
        });
    }

    private async request<T>(
        method: string,
        params: Record<string, unknown> = {},
    ): Promise<T> {
        const response = await fetch(this.endpoint, {
            method: "POST",
            headers: {
                authorization: this.authorization,
                "content-type": "application/json",
                accept: "application/json",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: ++this.requestId,
                method,
                params,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new KanboardError(`Kanboard returned HTTP ${response.status}: ${body}`);
        }

        let body: JsonRpcResponse<T>;
        try {
            body = await response.json() as JsonRpcResponse<T>;
        } catch {
            throw new KanboardError("Kanboard returned invalid JSON");
        }

        if (body.error) {
            throw new KanboardError(
                `Kanboard RPC ${body.error.code}: ${body.error.message}`,
                body.error.code,
                body.error.data,
            );
        }
        if (!Object.hasOwn(body, "result")) {
            throw new KanboardError(`Kanboard response to "${method}" had no result`);
        }
        return body.result as T;
    }

    private requireCreatedId(result: number | false, operation: string): number {
        if (result === false || result <= 0) {
            throw new KanboardError(`Kanboard could not ${operation}`);
        }
        return result;
    }
}

export class KanboardError extends Error {
    constructor(
        message: string,
        public readonly rpcCode?: number,
        public readonly rpcData?: unknown,
    ) {
        super(message);
        this.name = "KanboardError";
    }
}

export function toKanboardId(value: string | number, label = "Kanboard ID"): number {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 0) {
        throw new KanboardError(`${label} is invalid: ${String(value)}`);
    }
    return id;
}

function normalizeEndpoint(url: string): string {
    const normalized = url.trim().replace(/\/+$/, "");
    return normalized.endsWith("/jsonrpc.php")
        ? normalized
        : `${normalized}/jsonrpc.php`;
}
