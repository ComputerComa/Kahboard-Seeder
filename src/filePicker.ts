import * as p from "@clack/prompts";
import { globSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export async function pickYaml(
    definitionsFolder = "./defs",
): Promise<string | null> {
    const root = resolve(definitionsFolder);

    let files: string[];

    try {
        files = [
            ...globSync("**/*.yaml", { cwd: root }),
            ...globSync("**/*.yml", { cwd: root }),
        ]
            .map(file => resolve(root, file))
            .filter(file => statSync(file).isFile())
            .sort((a, b) =>
                relative(root, a).localeCompare(relative(root, b)),
            );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);

        p.log.error(`Could not read definitions folder: ${message}`);
        return null;
    }

    if (files.length === 0) {
        p.log.warning(`No .yaml or .yml files found under ${root}`);
        return null;
    }
    const selected = await p.autocomplete({
        message: "Select a project definition",
        placeholder: "Type to filter YAML files",
        maxItems: 10,

        options: files.map(file => ({
            value: file,
            label: relative(root, file),
            hint: file.endsWith(".yaml") ? "YAML" : "YML",
        })),
    });

    if (p.isCancel(selected) || typeof selected !== "string") {
        p.cancel("File selection cancelled");
        return null;
    }

    return selected;
}
