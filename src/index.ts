import * as p from "@clack/prompts";
import { applyPlan, ApplyError } from "./applyPlan.js";
import { loadConfig } from "./config.js";
import { pickYaml } from "./filePicker.js";
import { hashFile } from "./hashFile.js";
import { Kanboard } from "./kanboard.js";
import type { KanboardApi, KanboardUser } from "./kanboard.js";
import { loadManifest, ManifestError } from "./loadDef.js";
import { buildPlan, describeAction, MissingAssigneesError, PlanError } from "./planner.js";
import type { Plan } from "./planner.js";

async function main(): Promise<void> {
    p.intro("Kanboard Project Seeder");

    const selectedFile = await pickYaml("./defs");
    if (selectedFile === null) {
        p.outro("No definition selected");
        return;
    }

    const manifest = await loadManifest(selectedFile);
    const validatedHash = await hashFile(selectedFile);
    p.log.success(`Validated project: ${manifest.project.name}`);
    p.note([
        `Identifier: ${manifest.project.identifier}`,
        `Columns: ${manifest.columns.length}`,
        `Tasks: ${manifest.tasks.length}`,
    ].join("\n"), "Definition summary");

    const kanboard = new Kanboard(loadConfig());

    const connectionSpinner = p.spinner();
    connectionSpinner.start("Connecting to Kanboard");
    try {
        const version = await kanboard.getVersion();
        connectionSpinner.stop(`Connected to Kanboard ${version}`);
    } catch (error) {
        connectionSpinner.error("Could not connect to Kanboard");
        throw error;
    }

    const plan = await buildPlanWithAssigneePrompts(kanboard, manifest, validatedHash);

    if (plan.actions.length === 0) {
        p.outro("The project already matches the definition");
        return;
    }

    p.note(
        plan.actions.map((action, index) =>
            `${String(index + 1).padStart(2, " ")}. ${describeAction(action, manifest)}`
        ).join("\n"),
        "Proposed changes",
    );

    const approved = await p.confirm({
        message: `Apply ${plan.actions.length} planned changes?`,
        initialValue: false,
    });
    if (p.isCancel(approved) || approved !== true) {
        p.cancel("No changes were applied");
        return;
    }

    if (await hashFile(selectedFile) !== plan.manifestHash) {
        p.cancel("The YAML changed after planning. Validate and plan it again.");
        process.exitCode = 1;
        return;
    }

    const completed = await applyPlan(kanboard, plan);
    p.outro(`Applied ${completed} changes successfully`);
}

main().catch(error => {
    const message = error instanceof ApplyError && error.cause instanceof Error
        ? `${error.message}\nCause: ${error.cause.message}`
        : error instanceof ManifestError || error instanceof PlanError || error instanceof Error
            ? error.message
            : String(error);
    p.log.error(message);
    p.outro("Seeder stopped");
    process.exitCode = 1;
});

async function buildPlanWithAssigneePrompts(
    kanboard: KanboardApi,
    manifest: Awaited<ReturnType<typeof loadManifest>>,
    validatedHash: string,
): Promise<Plan> {
    const assigneeOverrides = new Map<string, KanboardUser>();

    while (true) {
        const planningSpinner = p.spinner();
        planningSpinner.start("Inspecting the current board");
        try {
            const plan = await buildPlan(kanboard, manifest, validatedHash, { assigneeOverrides });
            planningSpinner.stop(
                `Planned ${plan.actions.length} change${plan.actions.length === 1 ? "" : "s"}`,
            );
            return plan;
        } catch (error) {
            if (!(error instanceof MissingAssigneesError)) {
                planningSpinner.error("Could not build the plan");
                throw error;
            }

            planningSpinner.stop("Assignee mapping required");
            const mappings = await promptForAssigneeMappings(kanboard, error);
            if (mappings === null) {
                p.cancel("Assignee mapping cancelled");
                process.exitCode = 1;
                process.exit();
            }

            for (const [missingUsername, user] of mappings) {
                assigneeOverrides.set(missingUsername, user);
            }
        }
    }
}

async function promptForAssigneeMappings(
    kanboard: KanboardApi,
    error: MissingAssigneesError,
): Promise<Map<string, KanboardUser> | null> {
    const users = await kanboard.getUsers();
    if (users.length === 0) {
        throw new PlanError("Kanboard did not return any available users for assignee mapping");
    }

    const usersById = new Map(users.map(user => [String(user.id), user]));
    const mappings = new Map<string, KanboardUser>();

    for (const [missingUsername, taskReferences] of error.missingAssignees) {
        const selected = await p.select({
            message: `Map missing assignee "${missingUsername}" used by ${taskReferences.join(", ")}`,
            options: users.map(user => ({
                value: String(user.id),
                label: user.name ? `${user.username} (${user.name})` : user.username,
            })),
        });

        if (p.isCancel(selected) || typeof selected !== "string") {
            return null;
        }

        const user = usersById.get(selected);
        if (!user) {
            throw new PlanError(`Selected Kanboard user ID ${selected} was not returned by Kanboard`);
        }
        mappings.set(missingUsername, user);
    }

    return mappings;
}
