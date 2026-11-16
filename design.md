# Snack Counter Automation — System Design

## 1. Refill Lifecycle (`EMPTY` → `REIMBURSED`)
1. **Trigger (`EMPTY` → `ASSIGNED`)**: An employee flags a counter as empty via `/empty` in chat (or dashboard button). The rotation engine selects an eligible volunteer currently working *in that office* (excluding WFH, holiday, or traveling employees) with the lowest recent refill count.
2. **Commitment (`ASSIGNED` → `COMMITTED`)**: The selected volunteer receives an interactive chat prompt with a 2-hour SLA. Clicking **Accept** atomically locks the refill task so no duplicate purchases occur.
3. **Escalation (`ASSIGNED` → `EXPIRED` → New `ASSIGNED`)**: If the volunteer declines or ignores the prompt past the SLA window, the task expires and automatically reassigns to the next eligible volunteer in the queue.
4. **Receipt Submission (`COMMITTED` → `SUBMITTED_TO_HR`)**: After shopping, the volunteer submits the receipt image, amount, and snack category tags via chat. The system validates against the monthly office budget and dispatches a claim payload (`amount`, `currency`, `description`, `receiptImage`, `employeeId`) to the external HR API.
5. **Reimbursement (`SUBMITTED_TO_HR` → `REIMBURSED`)**: HR processes the claim (1–10 days) in the employee's payroll currency (NOK or INR). Once approved, the task closes and updates monthly spend analytics.

## 2. Main Components & Data Model
* **Core State Machine (`backend/core.js`)**: Pure, decoupled domain logic managing state transitions, atomic locks, and volunteer eligibility.
* **In-Memory Store**:
  * `Offices`: `id`, `name`, `currency` (`NOK`/`INR`), `monthlyBudget` (`6000`/`15000`), `currentSpent`, `typicalRange`.
  * `Employees`: `id`, `name`, `homeOffice`, `currentOffice` (supports cross-office visits), `status` (`IN_OFFICE`, `WFH`, `HOLIDAY`), `isVolunteer`, `refillCount`.
  * `RefillTasks`: `id`, `officeId`, `status`, `assignedTo`, `expiresAt`, `amount`, `currency`, `items`, `receiptImage`, `hrClaimId`.
  * `ChatMessages` & `HRClaims`: Simulated external adapter logs.
* **REST API & Static Server (`backend/server.js`)**: Exposes endpoints for triggering refills, simulating chat responses, submitting receipts, toggling volunteer availability, and fetching consolidated reports.

## 3. How Operational Problems Are Prevented
* **Boxes sitting empty for days**: Proactive assignment + strict SLA timers with automatic escalation to the next in-office volunteer.
* **Duplicate purchases**: State-level atomic locking (`status === 'ASSIGNED'` check before transitioning to `COMMITTED`) plus rejecting new triggers while an active task exists for that office.
* **Volunteer burnout & slow reimbursements**: Weighted round-robin rotation (`refillCount`) balances workload; instant API submission to HR eliminates manual form delays.
* **Lack of spend & snack visibility**: Live budget tracking per office, snack tag logging at receipt upload, and a consolidated management report normalizing INR and NOK.

## 4. Trade-Offs & Deliberate Omissions
* **In-Memory Storage over SQL/NoSQL**: Chosen for zero-setup portability in this MVP; the decoupled service layer allows swapping in PostgreSQL without changing business rules.
* **No Receipt OCR / Barcode Scanning**: Self-reported amounts + receipt photo attachments keep friction low for volunteers rather than building brittle supermarket OCR parsers.
* **Static FX Rate for Management Reporting**: Operational claims remain strictly in local payroll currencies (`NOK`/`INR`). A configurable FX rate is applied only when generating the consolidated monthly management view.