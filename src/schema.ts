import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

const taskSchema = z.object({
    id: nonEmptyString
        .toLowerCase()
        .regex(
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
            "Task ID must be a lowercase slug",
        ),

    reference: nonEmptyString
        .toUpperCase()
        .regex(
            /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
            "Reference must resemble NAS-001",
        ),

    title: nonEmptyString,

    column: nonEmptyString,

    assignee: nonEmptyString
        .toLowerCase()
        .optional(),

    description: z.string().default(""),

    due: z.string()
        .regex(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
            "Due date must use YYYY-MM-DD HH:mm",
        )
        .optional(),

    depends_on: z
        .array(nonEmptyString.toLowerCase())
        .default([]),

    subtasks: z
        .array(nonEmptyString)
        .default([]),
}).strict();

export const ProjectSchema = z.object({
    version: z.literal(1),

    project: z.object({
        identifier: nonEmptyString
            .regex(
                /^[A-Za-z0-9]+$/,
                "Kanboard identifiers may contain only letters and numbers",
            )
            .toUpperCase(),

        name: nonEmptyString,

        description: z.string().default(""),
    }).strict(),

    columns: z
        .array(nonEmptyString)
        .min(1, "At least one column must be defined"),

    tasks: z
        .array(taskSchema)
        .min(1, "At least one task must be defined"),
})
    .strict()
    .superRefine((data, ctx) => {
        const columns = new Set(data.columns);
        const taskIds = new Set(data.tasks.map(task => task.id));

        const seenTaskIds = new Set<string>();
        const seenReferences = new Set<string>();

        // Validate column uniqueness.
        if (columns.size !== data.columns.length) {
            ctx.addIssue({
                code: "custom",
                message: "Project columns must be unique",
                path: ["columns"],
            });
        }

        data.tasks.forEach((task, index) => {
            // Ensure the selected column exists.
            if (!columns.has(task.column)) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        `Task "${task.id}" uses unknown column "${task.column}"`,
                    path: ["tasks", index, "column"],
                });
            }

            // Ensure task IDs are unique.
            if (seenTaskIds.has(task.id)) {
                ctx.addIssue({
                    code: "custom",
                    message: `Duplicate task ID "${task.id}"`,
                    path: ["tasks", index, "id"],
                });
            }

            seenTaskIds.add(task.id);

            // Ensure Kanboard references are unique.
            if (seenReferences.has(task.reference)) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        `Duplicate task reference "${task.reference}"`,
                    path: ["tasks", index, "reference"],
                });
            }

            seenReferences.add(task.reference);

            // Validate dependencies.
            task.depends_on.forEach((dependency, dependencyIndex) => {
                if (dependency === task.id) {
                    ctx.addIssue({
                        code: "custom",
                        message:
                            `Task "${task.id}" cannot depend on itself`,
                        path: [
                            "tasks",
                            index,
                            "depends_on",
                            dependencyIndex,
                        ],
                    });
                } else if (!taskIds.has(dependency)) {
                    ctx.addIssue({
                        code: "custom",
                        message:
                            `Task "${task.id}" depends on unknown task "${dependency}"`,
                        path: [
                            "tasks",
                            index,
                            "depends_on",
                            dependencyIndex,
                        ],
                    });
                }
            });

            // Ensure dependencies aren't repeated.
            if (
                new Set(task.depends_on).size !==
                task.depends_on.length
            ) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        `Task "${task.id}" contains duplicate dependencies`,
                    path: ["tasks", index, "depends_on"],
                });
            }

            // Ensure subtasks aren't repeated.
            if (
                new Set(task.subtasks).size !==
                task.subtasks.length
            ) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        `Task "${task.id}" contains duplicate subtasks`,
                    path: ["tasks", index, "subtasks"],
                });
            }
        });

        const tasksById = new Map(data.tasks.map(task => [task.id, task]));
        const visiting = new Set<string>();
        const visited = new Set<string>();
        let cycleReported = false;

        const visit = (taskId: string, trail: string[]): void => {
            if (cycleReported || visited.has(taskId)) return;
            if (visiting.has(taskId)) {
                const cycleStart = trail.indexOf(taskId);
                const cycle = [...trail.slice(cycleStart), taskId];
                ctx.addIssue({
                    code: "custom",
                    message: `Dependency cycle detected: ${cycle.join(" -> ")}`,
                    path: ["tasks"],
                });
                cycleReported = true;
                return;
            }

            const task = tasksById.get(taskId);
            if (!task) return;
            visiting.add(taskId);
            for (const dependency of task.depends_on) {
                if (tasksById.has(dependency)) visit(dependency, [...trail, taskId]);
            }
            visiting.delete(taskId);
            visited.add(taskId);
        };

        for (const task of data.tasks) visit(task.id, []);
    });

export type ProjectDefinition =
    z.infer<typeof ProjectSchema>;
