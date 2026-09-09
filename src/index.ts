import * as p from "@clack/prompts";
import { pickYaml } from "./filePicker.js";
import {
    loadManifest,
    ManifestError,
} from "./loadDef.js";

p.intro("Kanboard Project Seeder");

const selectedFile = await pickYaml("./defs");

if (selectedFile === null) {
    process.exitCode = 1;
} else {
    try {
        const manifest = await loadManifest(selectedFile);

        p.log.success(
            `Valid project: ${manifest.project.name}`,
        );

        p.note(
            [
                `Identifier: ${manifest.project.identifier}`,
                `Columns: ${manifest.columns.length}`,
                `Tasks: ${manifest.tasks.length}`,
            ].join("\n"),
            "Definition summary",
        );

        p.outro("Definition passed validation");
    } catch (error) {
        const message =
            error instanceof ManifestError
                ? error.message
                : `Unexpected error: ${error instanceof Error
                    ? error.message
                    : String(error)
                }`;

        p.log.error(message);
        p.outro("Definition was not loaded");
        process.exitCode = 1;
    }
}
