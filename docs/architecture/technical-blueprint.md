# BRIXA — Technical Blueprint

## Cel

BRIXA is an AI-first design, marketing and workflow platform built around projects, reusable assets, Brand Brain and configurable BRIXY agents.

## Initial repository layout

```
apps/
  web/
  mobile/
  desktop/
services/
  api/
  ai-core/
  memory/
  context/
  orchestrator/
  brixy-runtime/
  workflow-engine/
  data-layer/
  integrations/
  analytics/
packages/
  database/
  auth/
  permissions/
  shared-types/
  ui/
  config/
database/
  schema/
  migrations/
  seeds/
infrastructure/
  docker/
  deployment/
  monitoring/
  backups/
  security/
docs/
  architecture/
  api/
  product/
  deployment/
tests/
  unit/
  integration/
  e2e/
```

## Core request flow

1. The API authenticates the user and resolves organization/project scope.
2. Context service gathers conversation, project, Brand Brain, knowledge and relevant memory.
3. Orchestrator selects the appropriate BRIXY or core capability.
4. Permission service checks tools, data access and approval requirements.
5. Runtime executes the task through approved tools.
6. The API returns the result and records an audit event, usage data and feedback.

## First implementation slice

The first vertical slice will cover:

- authenticated API health endpoint;
- project and organization identifiers;
- shared request/response types;
- permission decision contract;
- BRIXY execution contract;
- audit event contract;
- testable service boundaries.

## Non-negotiable rules

- No BRIXY may publish or mutate external resources without the required permission or human approval.
- Every tool execution must be auditable.
- Organization data must remain isolated.
- Core contracts must be shared between web, API and runtime.
- The first release should be modular, testable and deployable independently.

## Next build order

1. Monorepo skeleton and shared configuration.
2. API service with health and version endpoints.
3. Shared types for projects, tasks, permissions and audit events.
4. BRIXY runtime interfaces.
5. Persistence schema and migrations.
6. Web shell with authenticated workspace layout.
7. First end-to-end task through the orchestrator.
