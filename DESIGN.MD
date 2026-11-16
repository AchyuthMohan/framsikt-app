# Snack Counter Automation — Design Document

## 1. Overview & Automation Philosophy
To eliminate forgotten empty snack boxes, duplicate purchases, uneven volunteer burden, and untracked multi-currency spending across the **Oslo** and **Bengaluru** offices, this solution automates coordination and reimbursement orchestration via the company's existing **internal chat tool** and an **external HR API**. 

Rather than introducing heavy hardware or standalone portals for day-to-day users, "automation" here means **proactive task routing, deterministic concurrency locking, SLA-driven escalation, and one-click HR claim generation**.

---

## 2. Refill Lifecycle (`EMPTY` → `REIMBURSED`)

Each restocking event moves through a deterministic state machine:

```text
[EMPTY] ──(Trigger)──▶ [ASSIGNED] ──(Accept within 2h)──▶ [COMMITTED]
                           │                                   │
                    (Decline / 2h SLA)                  (Upload Receipt)
                           ▼                                   ▼
                      [REASSIGNED]                     [SUBMITTED_TO_HR]
                    (Next Volunteer)                           │
                                                       (HR Webhook/Poll)
                                                               ▼
                                                         [REIMBURSED]
```

1. **Trigger (`EMPTY` → `ASSIGNED`)**: Any employee flags a counter as empty using `/empty` in the internal chat tool (or the simulator dashboard). The rotation engine selects an eligible volunteer physically present in that office (`status === 'IN_OFFICE'`) with the lowest recent `refillCount`.
2. **Commitment (`ASSIGNED` → `COMMITTED`)**: The chosen volunteer receives a direct interactive chat message stating the office's typical purchase guidance (`300–1,200 NOK` in Oslo; `500–3,000 INR` in Bengaluru) and a **2-hour SLA**. Clicking **Accept ("I'll do it")** atomically locks the task to that volunteer.
3. **Escalation (`ASSIGNED` → Reassigned `ASSIGNED` / `EXPIRED`)**: If the volunteer declines or does not respond within the 2-hour SLA window, the task automatically escalates to the next eligible in-office volunteer (excluding volunteers already attempted for that refill).
4. **Receipt Submission (`COMMITTED` → `SUBMITTED_TO_HR`)**: After buying snacks, the volunteer submits the receipt photo, purchase amount, and snack category tags via chat. The system checks the monthly office budget, updates local spend, increments the volunteer's `refillCount`, and calls the external HR API (`amount`, `currency`, `description`, `receiptImage`, `employeeId`).
5. **Reimbursement (`SUBMITTED_TO_HR` → `REIMBURSED`)**: The external HR system processes approval (1–10 days) and reimburses the employee in their **home payroll currency** (`NOK` or `INR`), even if they bought snacks while visiting the other office.

---

## 3. Main Components & Data Model

The architecture separates domain rules from transport and external integrations so core business logic remains easily testable and storage-agnostic:

* **Core State Machine (`SnackCounterCore`)**: Pure domain module managing state transitions, atomic locking, SLA timeout evaluation, volunteer selection, and budget validation.
* **Data Entities**:
  * **Office**: `id`, `name`, `currency` (`NOK`/`INR`), `monthlyBudget` (`6,000 NOK` / `15,000 INR`), `typicalPurchase`, `currentSpent`.
  * **Employee**: `id`, `name`, `homeOffice`, `currentOffice` (tracks cross-office visits), `status` (`IN_OFFICE`, `WFH`, `HOLIDAY`), `isVolunteer`, `refillCount`.
  * **RefillTask**: `id`, `officeId`, `status` (`ASSIGNED`, `COMMITTED`, `SUBMITTED_TO_HR`, `REIMBURSED`, `EXPIRED`), `assignedTo`, `attemptedVolunteers`, `expiresAt`, `amount`, `currency`, `items`, `receiptImage`, `hrClaimId`, `budgetWarning`.
  * **HRClaim**: `claimId`, `taskId`, `employeeId`, `purchaseAmount`, `purchaseCurrency`, `reimbursementCurrency`, `description`, `receiptImage`, `status`.
  * **SnackAnalytics**: Per-office frequency map of snack tags logged during receipt submission.
* **External Adapters**:
  * **Internal Chat Adapter**: Sends targeted prompts with action buttons (`Accept` / `Decline`) and posts channel updates (`#oslo-snacks`, `#bengaluru-snacks`).
  * **External HR API Adapter**: Dispatches reimbursement payloads upon receipt upload and syncs approval status (`PENDING_HR_APPROVAL` → `REIMBURSED`).
* **Management Reporting Engine**: Aggregates local monthly spend and applies a reference FX rate (`1 INR = 0.12 NOK`) to produce a single consolidated monthly NOK total alongside snack popularity insights.

---

## 4. How Operational Problems Are Prevented

| Operational Problem | Prevention Mechanism |
| :--- | :--- |
| **Boxes sit empty for days** | Immediate targeted assignment on `/empty` backed by a 2-hour SLA timer and automatic escalation to the next in-office volunteer. |
| **Duplicate purchases on the same day** | Two-layer concurrency guard: (1) rejecting new `/empty` triggers while an `ASSIGNED` or `COMMITTED` task is active for that office, and (2) atomic state verification (`status === 'ASSIGNED'`) before locking `COMMITTED`. |
| **Few people do all refills & wait weeks for payout** | Fair rotation sorting by lowest `refillCount` balances workload; instant automated HR claim creation at receipt upload removes manual form delays. |
| **Hybrid schedules & cross-office visitors** | Volunteer selection filters strictly by `currentOffice` and `status === 'IN_OFFICE'` (skipping `WFH` and `HOLIDAY` staff, while allowing visiting colleagues to participate and still get reimbursed in their home payroll currency). |
| **No spend or snack consumption visibility** | Live monthly budget tracking with over-budget warnings, lightweight snack tagging at receipt upload, and a consolidated multi-currency monthly report for management. |

---

## 5. Trade-Offs & What Was Deliberately Not Built

* **In-Memory Store vs. Persistent Database (MVP Trade-Off)**: The prototype uses an in-memory store for zero-dependency execution and fast automated testing. Because all state mutations are encapsulated in `SnackCounterCore`, PostgreSQL or SQLite can be plugged in without modifying domain logic.
* **Deliberately Not Built — Receipt OCR / Supermarket Item Parsing**: Extracting line items and currencies across Norwegian and Indian receipts adds high complexity and failure modes. Self-reported totals + receipt photo attachments + optional snack tags achieve 95% of the value with minimal user friction.
* **Deliberately Not Built — Smart Weight Sensors / IoT Boxes**: Hardware scales require maintenance and procurement across two countries; a single `/empty` chat slash-command solves detection at zero hardware cost.
* **Deliberately Not Built — Live Multi-Currency Accounting Ledger**: Operational claims stay strictly in native currencies (`NOK`/`INR`) to match payroll rules; FX conversion is performed solely at read-time for management's monthly summary report.