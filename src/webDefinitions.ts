import { globSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const DEFINITIONS_FOLDER = "./defs";

export interface DefinitionFile {
    path: string;
    label: string;
}

export function listDefinitions(definitionsFolder = DEFINITIONS_FOLDER): DefinitionFile[] {
    const root = resolve(definitionsFolder);
    return [
        ...globSync("**/*.yaml", { cwd: root }),
        ...globSync("**/*.yml", { cwd: root }),
    ]
        .map(file => resolve(root, file))
        .filter(file => statSync(file).isFile())
        .sort((a, b) => relative(root, a).localeCompare(relative(root, b)))
        .map(path => ({ path, label: relative(root, path) }));
}

export function resolveDefinitionPath(
    requestedPath: string,
    definitionsFolder = DEFINITIONS_FOLDER,
): string {
    const root = resolve(definitionsFolder);
    const filePath = resolve(requestedPath);
    if (!filePath.startsWith(`${root}/`) && filePath !== root) {
        throw new Error("Definition file must be under defs/");
    }
    return filePath;
}
