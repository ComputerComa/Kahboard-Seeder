import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import {
    ProjectSchema,
    type ProjectDefinition,
} from "./schema.js";

export async function loadManifest(
    filePath: string,
): Promise<ProjectDefinition> {
    let contents: string;

    try {
        contents = await readFile(filePath, "utf8");
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);

        throw new ManifestError(
            `Could not read "${filePath}": ${message}`,
        );
    }

    let unvalidated: unknown;

    try {
        unvalidated = parseYaml(contents);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);

        throw new ManifestError(`Invalid YAML: ${message}`);
    }

    const result = ProjectSchema.safeParse(unvalidated);

    if (!result.success) {
        const issues = result.error.issues
            .map(issue => {
                const path = formatIssuePath(issue.path);
                return `${path}: ${issue.message}`;
            })
            .join("\n");

        throw new ManifestError(
            `Definition validation failed:\n${issues}`,
        );
    }

    return result.data;
}

function formatIssuePath(
    path: PropertyKey[],
): string {
    if (path.length === 0) {
        return "<document>";
    }

    return path.reduce<string>((result, segment) => {
        if (typeof segment === "number") {
            return `${result}[${segment}]`;
        }

        if (typeof segment === "symbol") {
            return result;
        }

        return result.length === 0
            ? String(segment)
            : `${result}.${String(segment)}`;
    }, "");
}

export class ManifestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ManifestError";
    }
}
