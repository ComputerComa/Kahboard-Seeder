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

export interface CreateProjectOptions {
    name: string;
    identifier: string;
    description?: string;
}

interface JsonRpcResponse<T> {
    jsonrpc: "2.0";
    id: number;
    result?: T;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

export class Kanboard {
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

    async getVersion(): Promise<string> {
        return this.request<string>("getVersion");
    }

    async getProjects(): Promise<KanboardProject[]> {
        return this.request<KanboardProject[]>(
            "getMyProjects",
        );
    }

    async getProjectByIdentifier(
        identifier: string,
    ): Promise<KanboardProject | null> {
        const result = await this.request<
            KanboardProject | false | null
        >(
            "getProjectByIdentifier",
            { identifier },
        );

        return result || null;
    }

    async createProject(
        options: CreateProjectOptions,
    ): Promise<number> {
        const result = await this.request<number | false>(
            "createProject",
            {
                name: options.name,
                identifier: options.identifier,
                description: options.description ?? "",
            },
        );

        if (result === false) {
            throw new KanboardError(
                `Kanboard could not create project "${options.name}"`,
            );
        }

        return result;
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

            throw new KanboardError(
                `Kanboard returned HTTP ${response.status}: ${body}`,
            );
        }

        const body =
            await response.json() as JsonRpcResponse<T>;

        if (body.error) {
            throw new KanboardError(
                `Kanboard RPC ${body.error.code}: ${body.error.message}`,
                body.error.code,
                body.error.data,
            );
        }

        if (!Object.hasOwn(body, "result")) {
            throw new KanboardError(
                `Kanboard response to "${method}" had no result`,
            );
        }

        return body.result as T;
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

function normalizeEndpoint(url: string): string {
    const normalized = url.trim().replace(/\/+$/, "");

    return normalized.endsWith("/jsonrpc.php")
        ? normalized
        : `${normalized}/jsonrpc.php`;
}
