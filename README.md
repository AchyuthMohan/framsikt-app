# Snack Counter Automation — System Design & Implementation

A full-stack MVP built with **Node.js**, **Express**, and **Vanilla HTML/CSS/JS** to automate office snack counter restocking, hybrid volunteer rotation, internal chat notifications, and HR reimbursement claims across the **Oslo** and **Bengaluru** offices.

---

## Table of Contents
1. [Project Structure](#project-structure)
2. [Local Setup & Execution](#local-setup--execution)
3. [Docker Setup & Execution](#docker-setup--execution)
4. [System Design Document](#system-design-document)
   - [1. Refill Lifecycle (`EMPTY` → `REIMBURSED`)](#1-refill-lifecycle-empty--reimbursed)
   - [2. Architecture, Components & Data Model](#2-architecture-components--data-model)
   - [3. How Operational Problems Are Prevented](#3-how-operational-problems-are-prevented)
   - [4. Trade-Offs & Deliberate Omissions](#4-trade-offs--deliberate-omissions)
5. [API Endpoints & Test Coverage](#api-endpoints--test-coverage)

---

## Project Structure

```text
root/
├── Dockerfile               # Container definition (Node 20 Alpine)
├── .dockerignore            # Excludes node_modules and local metadata
├── package.json             # Project scripts and Express dependency
├── README.md                # Comprehensive system design & setup guide
├── backend/
│   ├── core.js              # Decoupled business logic, state machine & in-memory store
│   ├── core.test.js         # Automated test suite (Node native test runner)
│   └── server.js            # Express REST API & static file server
└── frontend/
    ├── index.html           # 3-panel interactive simulator UI
    ├── styles.css           # Responsive dashboard styling
    └── script.js            # Vanilla JS frontend state & API client
```

---

## Local Setup & Execution

### Prerequisites
* **Node.js**: `v18.0.0` or higher (`v20+` recommended for built-in test runner support).
* **npm**: Installed automatically with Node.js.

### Step-by-Step Instructions

1. **Navigate to the project root directory:**
   ```bash
   cd root
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the automated test suite:**
   Proves concurrency locking, SLA timeout escalation, cross-office visiting employee handling, and multi-currency budget aggregation:
   ```bash
   npm test
   ```

4. **Start the application server:**
   ```bash
   npm start
   ```

5. **Open the interactive simulator:**
   Open your browser and go to:
   ```text
   http://localhost:3000
   ```

---

## Docker Setup & Execution

### Prerequisites
* **Docker**: Installed and running on your machine.

### Step-by-Step Instructions

1. **Build the Docker image:**
   ```bash
   docker build -t snack-counter-mvp .
   ```

2. **Run the container:**
   ```bash
   docker run -p 3000:3000 snack-counter-mvp
   ```

3. **Run automated tests inside the container (optional):**
   ```bash
   docker run --rm snack-counter-mvp npm test
   ```

4. **Access the application:**
   Open `http://localhost:3000` in your browser.

---

## System Design Document

### 1. Refill Lifecycle (`EMPTY` → `REIMBURSED`)

The system models each restocking event as a deterministic state machine to eliminate ambiguity, double-buying, and forgotten boxes:

1. **Trigger (`EMPTY` → `ASSIGNED`)**:
   * An employee flags a counter as empty via `/empty` in the internal chat tool (or via the **Mark Box Empty** dashboard button).
   * The rotation engine queries volunteers currently working *in that specific office* (`status === 'IN_OFFICE'`, excluding `WFH` and `HOLIDAY` employees, while automatically including employees visiting from the other office).
   * It selects the eligible volunteer with the lowest recent `refillCount`.
2. **Commitment (`ASSIGNED` → `COMMITTED`)**:
   * The selected volunteer receives an interactive chat prompt with a **2-hour SLA window** and typical budget guidance (`300–1,200 NOK` in Oslo; `500–3,000 INR` in Bengaluru).
   * Clicking **Accept ("I'll do it")** atomically locks the refill task to that volunteer so no duplicate purchases can occur.
3. **Escalation (`ASSIGNED` → `EXPIRED` → Reassigned `ASSIGNED`)**:
   * If the volunteer declines or ignores the prompt past the 2-hour SLA window, the task escalates and automatically reassigns to the next eligible volunteer in the queue (excluding volunteers already attempted for that refill).
4. **Receipt Submission (`COMMITTED` → `SUBMITTED_TO_HR`)**:
   * After shopping, the volunteer submits the receipt photo, purchase amount, and snack category tags via chat.
   * The system validates the spend against the office's monthly budget (`6,000 NOK` / `15,000 INR`), flags any budget overrun, increments the volunteer's `refillCount`, and immediately dispatches a claim payload (`purchaseAmount`, `purchaseCurrency`, `reimbursementCurrency`, `description`, `receiptImage`, `employeeId`) to the external HR API.
5. **Reimbursement (`SUBMITTED_TO_HR` → `REIMBURSED`)**:
   * The external HR system processes the claim (1–10 days) and reimburses the employee in their **home payroll currency** (`NOK` or `INR`), even if they purchased snacks while visiting the other office. Once approved, the task closes and updates monthly spend analytics.

---

### 2. Architecture, Components & Data Model

The application is cleanly separated into a pure domain core, a lightweight HTTP/API layer, and a zero-dependency simulator UI:

* **Core State Machine (`backend/core.js`)**:
  Pure, framework-agnostic business logic (`SnackCounterCore`) managing state transitions, concurrency locks, SLA timers, budget validation, and volunteer eligibility. Because it has zero Express or UI dependencies, automated tests execute directly against it.
* **In-Memory Data Store**:
  * `Offices`: `id`, `name`, `currency` (`NOK`/`INR`), `monthlyBudget` (`6000`/`15000`), `typicalPurchase`, `currentSpent`.
  * `Employees`: `id`, `name`, `homeOffice`, `currentOffice` (supports cross-office visits), `status` (`IN_OFFICE`, `WFH`, `HOLIDAY`), `isVolunteer`, `refillCount`.
  * `RefillTasks`: `id`, `officeId`, `status` (`ASSIGNED`, `COMMITTED`, `SUBMITTED_TO_HR`, `REIMBURSED`, `EXPIRED`), `assignedTo`, `assignedName`, `attemptedVolunteers`, `expiresAt`, `amount`, `currency`, `items`, `receiptImage`, `hrClaimId`, `budgetWarning`.
  * `ChatMessages` & `HRClaims`: Simulated external adapter logs (`chatLog` and `hrClaims`) mirroring real-world chat bot messages and external HR reimbursement tickets.
  * `SnackAnalytics`: Frequency map (`snackAnalytics`) tracking which snack items are purchased per office.
* **REST API & Static Server (`backend/server.js`)**:
  Serves the static frontend (`frontend/`) and exposes REST endpoints for state retrieval, triggering refills, simulating chat responses, submitting receipts, approving HR claims, and toggling employee hybrid availability.
* **Interactive Simulator UI (`frontend/index.html`, `styles.css`, `script.js`)**:
  A 3-column vanilla HTML/CSS/JS workspace that lets reviewers simulate the entire end-to-end flow on a single screen:
  1. *Left Panel*: Office budget progress bars, empty box triggers, and clickable hybrid status toggles (`IN_OFFICE` / `WFH` / `HOLIDAY`).
  2. *Middle Panel*: Simulated internal chat bot feed with interactive **Accept**, **Decline**, and **Simulate Timeout** buttons, plus the receipt upload form.
  3. *Right Panel*: External HR reimbursement approval queue, popular snack breakdown, and a top consolidated management report banner.

---

### 3. How Operational Problems Are Prevented

| Operational Problem | How the System Prevents It |
| :--- | :--- |
| **Boxes sit empty for days** | Proactive volunteer assignment triggered on `/empty`, backed by a strict 2-hour SLA timer and automatic escalation to the next in-office volunteer. |
| **Duplicate purchases on the same day** | Two-layer locking: (1) rejecting new `/empty` triggers if an `ASSIGNED` or `COMMITTED` task is already active for that office, and (2) atomic state checks (`status === 'ASSIGNED'`) when committing. |
| **Volunteer burnout & slow reimbursements** | Weighted round-robin rotation (`refillCount`) distributes refills fairly across present volunteers; instant API claim submission at receipt upload eliminates manual HR form delays. |
| **No visibility into spend or popular snacks** | Live monthly budget tracking with over-budget warnings, snack tag logging at receipt submission, and a consolidated management report normalizing `INR` and `NOK`. |
| **Hybrid work & cross-office travel edge cases** | Rotation filters strictly by `currentOffice` and `status === 'IN_OFFICE'`, while HR claims route payouts in the employee's `homeOffice` payroll currency. |

---

### 4. Trade-Offs & Deliberate Omissions

* **In-Memory Storage over SQL/NoSQL**: Chosen for zero-setup portability and instant test execution in this MVP. Because all state mutations live inside `SnackCounterCore`, a persistence adapter (PostgreSQL/SQLite) can be swapped in without changing business rules.
* **No Receipt OCR / Barcode Scanning**: Self-reported amounts paired with receipt image attachments keep submission fast and reliable for volunteers rather than building brittle supermarket receipt OCR parsers across two countries.
* **Static FX Rate for Management Reporting**: Operational claims remain strictly in local currencies (`NOK`/`INR`) to match accounting and payroll reality. A configurable reference FX rate (`1 INR = 0.12 NOK`) is applied solely when generating management's consolidated monthly view.
* **Interactive Sandbox UI vs. Native Chat Integration**: In production, employees would interact exclusively via Slack/Microsoft Teams webhooks without opening a separate web app. The 3-panel web UI serves as an all-in-one simulator so evaluators can inspect chat prompts, HR claims, and consolidated reporting side by side.

---

## API Endpoints & Test Coverage

### Key REST Endpoints (`backend/server.js`)
* `GET /api/state` — Returns offices, employees, tasks, chat logs, HR claims, and the consolidated management report.
* `POST /api/offices/:officeId/empty` — Marks an office snack counter empty and assigns the next eligible volunteer.
* `POST /api/tasks/:taskId/commit` — Atomically locks an assigned refill task for the assigned volunteer.
* `POST /api/tasks/:taskId/escalate` — Reassigns a declined or timed-out task to the next eligible volunteer.
* `POST /api/tasks/:taskId/receipt` — Validates budget, records snack tags, updates spend, and dispatches a claim to the simulated HR API.
* `POST /api/hr/claims/:claimId/approve` — Simulates HR approving a claim and completing reimbursement.
* `POST /api/employees/:id/status` — Toggles an employee's hybrid status (`IN_OFFICE`, `WFH`, `HOLIDAY`) or visiting office.
* `POST /api/reset` — Resets the in-memory store to its initial demo state.

### Automated Tests (`backend/core.test.js`)
Executed via `npm test`:
1. **Concurrency & Double-Buy Prevention**: Verifies two volunteers cannot commit to the same refill and duplicate empty triggers are blocked while a refill is active.
2. **SLA Timeout & Reassignment**: Verifies uncompleted tasks past the 2-hour window automatically escalate to another `IN_OFFICE` volunteer while skipping `WFH` and `HOLIDAY` staff.
3. **Cross-Office Visitors & Payroll Currency**: Verifies an Oslo employee visiting Bengaluru can be assigned a Bengaluru refill and receive reimbursement in their home payroll currency (`NOK`).
4. **Budget Thresholds & Multi-Currency Totals**: Verifies over-budget purchases trigger warnings and consolidated monthly reporting accurately converts `INR` + `NOK` totals.