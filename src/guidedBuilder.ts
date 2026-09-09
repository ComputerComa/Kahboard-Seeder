import * as p from "@clack/prompts";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { ProjectSchema, type ProjectDefinition } from "./schema.js";

const DEFAULT_COLUMNS = [
    "Backlog",
    "Ready",
    "Work in progress",
    "Waiting",
    "Done",
];

interface GuidedTask {
    id: string;
    reference: string;
    title: string;
    column: string;
    assignee?: string;
    description: string;
    depends_on: string[];
    subtasks: string[];
}

export async function createDefinitionInteractively(
    definitionsFolder = "./defs",
): Promise<string | null> {
    const projectName = await requiredText("Project name", "Homelab Server Migration");
    if (projectName === null) return null;

    const identifier = await requiredText(
        "Project identifier",
        slugifyIdentifier(projectName),
        value => /^[A-Za-z0-9]+$/.test(value)
            ? undefined
            : "Use only letters and numbers",
    );
    if (identifier === null) return null;

    const description = await optionalMultiline("Project description");
    if (description === null) return null;

    const useDefaultColumns = await p.confirm({
        message: "Use Kanboard default columns?",
        initialValue: true,
    });
    if (p.isCancel(useDefaultColumns)) return null;

    const columns = useDefaultColumns
        ? DEFAULT_COLUMNS
        : await promptColumns();
    if (columns === null) return null;

    const tasks: GuidedTask[] = [];
    let previousTaskId: string | null = null;
    let addAnotherPhase = true;

    while (addAnotherPhase) {
        const phaseName = await requiredText("Phase name", "Initial setup");
        if (phaseName === null) return null;

        const referencePrefix = await requiredText(
            `Reference prefix for ${phaseName}`,
            defaultReferencePrefix(phaseName),
            value => /^[A-Za-z0-9]+$/.test(value)
                ? undefined
                : "Use only letters and numbers",
        );
        if (referencePrefix === null) return null;

        let addAnotherTask = true;
        let phaseTaskNumber = 1;
        while (addAnotherTask) {
            const task = await promptTask({
                columns,
                phaseName,
                referencePrefix,
                taskNumber: phaseTaskNumber,
                existingTasks: tasks,
                previousTaskId,
            });
            if (task === null) return null;

            tasks.push(task);
            previousTaskId = task.id;
            phaseTaskNumber += 1;

            const shouldAddTask = await confirm("Add another task to this phase?", false);
            if (shouldAddTask === null) return null;
            addAnotherTask = shouldAddTask;
        }

        const shouldAddPhase = await confirm("Add another phase?", false);
        if (shouldAddPhase === null) return null;
        addAnotherPhase = shouldAddPhase;
    }

    const manifest = ProjectSchema.parse({
        version: 1,
        project: {
            identifier,
            name: projectName,
            description,
        },
        columns,
        tasks,
    });

    p.note(summary(manifest), "Generated definition");

    const savedPath = await promptAndSaveManifest(definitionsFolder, manifest);
    if (savedPath === null) return null;

    p.log.success(`Saved ${savedPath}`);
    return savedPath;
}

async function promptColumns(): Promise<string[] | null> {
    const input = await requiredText(
        "Columns, comma-separated",
        DEFAULT_COLUMNS.join(", "),
        value => value.split(",").some(part => part.trim().length > 0)
            ? undefined
            : "Enter at least one column",
    );
    if (input === null) return null;

    return input
        .split(",")
        .map(column => column.trim())
        .filter(Boolean);
}

async function promptTask(options: {
    columns: string[];
    phaseName: string;
    referencePrefix: string;
    taskNumber: number;
    existingTasks: GuidedTask[];
    previousTaskId: string | null;
}): Promise<GuidedTask | null> {
    const title = await requiredText(`Task title for ${options.phaseName}`, "Prepare the system");
    if (title === null) return null;

    const id = await requiredText(
        "Task ID",
        uniqueSlug(slugifyTaskId(title), options.existingTasks.map(task => task.id)),
        value => {
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
                return "Use a lowercase slug like new-nas-setup";
            }
            return options.existingTasks.some(task => task.id === value)
                ? "Task ID already exists"
                : undefined;
        },
    );
    if (id === null) return null;

    const reference = await requiredText(
        "Task reference",
        `${options.referencePrefix.toUpperCase()}-${String(options.taskNumber).padStart(3, "0")}`,
        value => {
            if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)) {
                return "Use a reference like NAS-001";
            }
            return options.existingTasks.some(task => task.reference === value.toUpperCase())
                ? "Task reference already exists"
                : undefined;
        },
    );
    if (reference === null) return null;

    const column = await p.select({
        message: "Starting column",
        options: options.columns.map(value => ({ value })),
        initialValue: defaultColumn(options.columns, options.existingTasks.length === 0 ? "Ready" : "Backlog"),
    });
    if (p.isCancel(column) || typeof column !== "string") return null;

    const assignee = await optionalText("Assignee override");
    if (assignee === null) return null;

    const description = await optionalMultiline("Task description");
    if (description === null) return null;

    const depends_on = await promptDependencies(options.existingTasks, options.previousTaskId);
    if (depends_on === null) return null;

    const subtasks = await promptSubtasks();
    if (subtasks === null) return null;

    return {
        id,
        reference,
        title,
        column,
        ...(assignee.length === 0 ? {} : { assignee }),
        description,
        depends_on,
        subtasks,
    };
}

async function promptDependencies(
    existingTasks: GuidedTask[],
    previousTaskId: string | null,
): Promise<string[] | null> {
    if (existingTasks.length === 0) return [];

    const mode = await p.select({
        message: "Task dependencies",
        options: [
            { value: "previous", label: "Depend on previous task" },
            { value: "manual", label: "Choose dependencies" },
            { value: "none", label: "No dependencies" },
        ],
        initialValue: previousTaskId === null ? "none" : "previous",
    });
    if (p.isCancel(mode) || typeof mode !== "string") return null;

    if (mode === "none" || previousTaskId === null) return [];
    if (mode === "previous") return [previousTaskId];

    const selected = await p.multiselect({
        message: "Select dependencies",
        options: existingTasks.map(task => ({
            value: task.id,
            label: `${task.reference} ${task.title}`,
        })),
        initialValues: previousTaskId ? [previousTaskId] : [],
    });
    if (!Array.isArray(selected)) return null;
    return selected.filter((value): value is string => typeof value === "string");
}

async function promptSubtasks(): Promise<string[] | null> {
    const subtasks: string[] = [];

    while (true) {
        const shouldAdd = await confirm("Add a subtask?", subtasks.length === 0);
        if (shouldAdd === null) return null;
        if (!shouldAdd) return subtasks;

        const subtask = await requiredText("Subtask", "Verify the result");
        if (subtask === null) return null;
        subtasks.push(subtask);
    }
}

async function promptAndSaveManifest(
    definitionsFolder: string,
    manifest: ProjectDefinition,
): Promise<string | null> {
    const root = resolve(definitionsFolder);
    await mkdir(root, { recursive: true });

    while (true) {
        const fileName = await requiredText(
            "Save definition as",
            `${slugifyTaskId(manifest.project.name)}.yml`,
            value => /^[a-z0-9]+(?:-[a-z0-9]+)*\.ya?ml$/.test(value)
                ? undefined
                : "Use a filename like homelab-migration.yml",
        );
        if (fileName === null) return null;

        const filePath = resolve(root, fileName);
        if (!filePath.startsWith(`${root}/`)) {
            p.log.error("Definition file must stay inside the definitions folder");
            continue;
        }

        if (await fileExists(filePath)) {
            const overwrite = await confirm(`Overwrite ${fileName}?`, false);
            if (overwrite === null) return null;
            if (!overwrite) continue;
        }

        await writeFile(filePath, stringifyYaml(manifest), "utf8");
        return filePath;
    }
}

async function requiredText(
    message: string,
    initialValue: string,
    validate?: (value: string) => string | undefined,
): Promise<string | null> {
    const result = await p.text({
        message,
        initialValue,
        validate: value => {
            const text = value?.trim() ?? "";
            if (text.length === 0) return "Required";
            return validate?.(text);
        },
    });

    return typeof result === "string" ? result.trim() : null;
}

async function optionalText(message: string): Promise<string | null> {
    const result = await p.text({ message, placeholder: "Leave blank to skip" });
    return typeof result === "string" ? result.trim() : null;
}

async function optionalMultiline(message: string): Promise<string | null> {
    const result = await p.multiline({
        message,
        placeholder: "Leave blank to skip",
        showSubmit: true,
    });
    return typeof result === "string" ? result.trim() : null;
}

async function confirm(message: string, initialValue: boolean): Promise<boolean | null> {
    const result = await p.confirm({ message, initialValue });
    return typeof result === "boolean" ? result : null;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

function summary(manifest: ProjectDefinition): string {
    return [
        `Identifier: ${manifest.project.identifier}`,
        `Columns: ${manifest.columns.length}`,
        `Tasks: ${manifest.tasks.length}`,
        `Subtasks: ${manifest.tasks.reduce((total, task) => total + task.subtasks.length, 0)}`,
    ].join("\n");
}

function defaultColumn(columns: string[], preferred: string): string {
    return columns.includes(preferred) ? preferred : columns[0]!;
}

export function slugifyIdentifier(input: string): string {
    const identifier = input.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
    return identifier.length === 0 ? "PROJECT" : identifier;
}

export function slugifyTaskId(input: string): string {
    const slug = input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return slug.length === 0 ? "task" : slug;
}

export function uniqueSlug(slug: string, existing: string[]): string {
    const existingSlugs = new Set(existing);
    if (!existingSlugs.has(slug)) return slug;

    let suffix = 2;
    while (existingSlugs.has(`${slug}-${suffix}`)) suffix += 1;
    return `${slug}-${suffix}`;
}

export function defaultReferencePrefix(phaseName: string): string {
    const words = phaseName
        .trim()
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);

    const prefix = words.length === 1
        ? words[0]!.slice(0, 4)
        : words.map(word => word[0]).join("");

    return slugifyIdentifier(prefix).slice(0, 4) || "TASK";
}
