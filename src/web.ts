import express from "express";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { applyPlanWithReporter } from "./applyPlan.js";
import { loadConfig, loadWebConfig } from "./config.js";
import { hashFile } from "./hashFile.js";
import { Kanboard } from "./kanboard.js";
import type { KanboardUser } from "./kanboard.js";
import { loadManifest } from "./loadDef.js";
import { buildPlan, describeAction, MissingAssigneesError } from "./planner.js";
import type { Plan } from "./planner.js";
import { listDefinitions, resolveDefinitionPath } from "./webDefinitions.js";
import { credentialsMatch, login, logout, requireAuth } from "./webAuth.js";

interface StoredPlan {
    definitionPath: string;
    plan: Plan;
}

const plans = new Map<string, StoredPlan>();
const kanboard = new Kanboard(loadConfig());
const webConfig = loadWebConfig();
const app = express();

app.set("view engine", "ejs");
app.set("views", resolve("views"));
app.use(express.urlencoded({ extended: true }));
app.use("/assets", express.static(resolve("public")));
app.get("/assets/htmx.min.js", (_request, response) => {
    response.sendFile(resolve("node_modules/htmx.org/dist/htmx.min.js"));
});
app.use(requireAuth(webConfig));

app.get("/login", (_request, response) => {
    response.render("login", { error: null });
});

app.post("/login", (request, response) => {
    const username = String(request.body.username ?? "");
    const password = String(request.body.password ?? "");
    if (!credentialsMatch(username, password, webConfig)) {
        response.status(401).render("login", { error: "Invalid username or password" });
        return;
    }

    login(response, webConfig);
    response.redirect("/");
});

app.post("/logout", (_request, response) => {
    logout(response);
    response.redirect("/login");
});

app.get("/", (_request, response) => {
    response.render("index", {
        definitions: listDefinitions(),
    });
});

app.post("/plan", asyncRoute(async (request, response) => {
    const definitionPath = resolveDefinitionPath(String(request.body.definitionPath ?? ""));
    const manifest = await loadManifest(definitionPath);
    const manifestHash = await hashFile(definitionPath);
    const assigneeOverrides = await assigneeOverridesFromBody(request.body);

    try {
        const plan = await buildPlan(kanboard, manifest, manifestHash, { assigneeOverrides });
        const planId = randomUUID();
        plans.set(planId, { definitionPath, plan });
        response.render("partials/plan", {
            planId,
            manifest,
            actions: plan.actions.map(action => describeAction(action, manifest)),
            actionCount: plan.actions.length,
        });
    } catch (error) {
        if (!(error instanceof MissingAssigneesError)) throw error;

        response.status(409).render("partials/assigneeMapping", {
            definitionPath,
            manifest,
            missingAssignees: [...error.missingAssignees].map(([username, taskReferences]) => ({
                username,
                taskReferences,
            })),
            users: await kanboard.getUsers(),
        });
    }
}));

app.post("/apply", asyncRoute(async (request, response) => {
    const planId = String(request.body.planId ?? "");
    const stored = plans.get(planId);
    if (!stored) {
        response.status(409).render("partials/error", {
            message: "No matching plan was found. Validate and plan the definition again.",
        });
        return;
    }

    if (await hashFile(stored.definitionPath) !== stored.plan.manifestHash) {
        plans.delete(planId);
        response.status(409).render("partials/error", {
            message: "The YAML changed after planning. Validate and plan it again.",
        });
        return;
    }

    const events: Array<{ description: string; status: string; message: string }> = [];
    const completed = await applyPlanWithReporter(kanboard, stored.plan, event => {
        events.push({
            description: event.description,
            status: event.status,
            message: event.message ?? (event.error instanceof Error ? event.error.message : "Failed"),
        });
    });
    plans.delete(planId);

    response.render("partials/applyResult", {
        completed,
        events,
    });
}));

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    response.status(500).render("partials/error", { message });
});

app.listen(webConfig.port, () => {
    console.log(`Kanboard Seeder web app listening on http://127.0.0.1:${webConfig.port}`);
});

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
    return (request: Request, response: Response, next: NextFunction): void => {
        handler(request, response).catch(next);
    };
}

async function assigneeOverridesFromBody(body: Record<string, unknown>): Promise<Map<string, KanboardUser>> {
    const entries = Object.entries(body)
        .filter(([key]) => key.startsWith("assignee:"))
        .map(([key, value]) => [key.slice("assignee:".length), String(value)] as const)
        .filter(([, userId]) => userId.length > 0);

    if (entries.length === 0) return new Map();

    const users = await kanboard.getUsers();
    const usersById = new Map(users.map(user => [String(user.id), user]));
    const overrides = new Map<string, KanboardUser>();
    for (const [missingUsername, userId] of entries) {
        const user = usersById.get(userId);
        if (user) overrides.set(missingUsername, user);
    }
    return overrides;
}
