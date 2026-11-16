const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SnackCounterCore } = require('./core');

describe('Snack Counter Automation Rules', () => {
  let core;

  beforeEach(() => {
    core = new SnackCounterCore();
  });

  it('prevents two people from committing to the same refill', () => {
    const task = core.triggerEmpty('oslo');
    const assignedId = task.assignedTo;
    const otherId = assignedId === 'emp-oslo-1' ? 'emp-oslo-2' : 'emp-oslo-1';

    // First volunteer commits
    const committed = core.commitTask(task.id, assignedId);
    assert.equal(committed.status, 'COMMITTED');

    // Another volunteer tries to commit to the same task
    assert.throws(() => {
      core.commitTask(task.id, otherId);
    }, /Cannot commit: task is already COMMITTED/);

    // Triggering another empty box while one is active also fails
    assert.throws(() => {
      core.triggerEmpty('oslo');
    }, /already in progress/);
  });

  it('hands an uncompleted/timed-out refill to another in-office volunteer', () => {
    const startTime = new Date('2026-11-16T10:00:00Z');
    const task = core.triggerEmpty('bengaluru', startTime);
    const firstVolunteer = task.assignedTo;

    // Fast-forward 3 hours (past 2-hour SLA)
    const afterTimeout = new Date('2026-11-16T13:00:00Z');
    const escalated = core.checkAndEscalateTimeouts(afterTimeout);

    assert.equal(escalated.length, 1);
    assert.equal(escalated[0].status, 'ASSIGNED');
    assert.notEqual(escalated[0].assignedTo, firstVolunteer);
    // Must not assign to employees on HOLIDAY or WFH
    assert.notEqual(escalated[0].assignedTo, 'emp-blr-3');
    assert.notEqual(escalated[0].assignedTo, 'emp-blr-4');
  });

  it('allows visiting employees from another office to be selected if IN_OFFICE', () => {
    // Henrik Dahl is from Oslo, visiting Bengaluru (emp-oslo-4, refillCount: 0)
    // Make local Bengaluru volunteers unavailable
    core.setEmployeeStatus('emp-blr-1', 'WFH');
    core.setEmployeeStatus('emp-blr-2', 'WFH');

    const task = core.triggerEmpty('bengaluru');
    assert.equal(task.assignedTo, 'emp-oslo-4');

    core.commitTask(task.id, 'emp-oslo-4');
    const { claim } = core.submitReceipt(task.id, 'emp-oslo-4', {
      amount: 1200,
      items: ['Coffee', 'Biscuits'],
    });

    // Purchase is in INR, but Henrik is reimbursed in his payroll currency (NOK)
    assert.equal(claim.purchaseCurrency, 'INR');
    assert.equal(claim.reimbursementCurrency, 'NOK');
  });

  it('calculates budgets, flags over-budget spend, and aggregates multi-currency totals accurately', () => {
    // Oslo purchase: 1,500 NOK
    const osloTask = core.triggerEmpty('oslo');
    core.commitTask(osloTask.id, osloTask.assignedTo);
    const osloRes = core.submitReceipt(osloTask.id, osloTask.assignedTo, {
      amount: 1500,
      items: ['Bananas', 'Nuts'],
    });
    assert.equal(osloRes.task.budgetWarning, false);

    // Bengaluru purchase: 16,000 INR (exceeds 15,000 INR budget)
    const blrTask = core.triggerEmpty('bengaluru');
    core.commitTask(blrTask.id, blrTask.assignedTo);
    const blrRes = core.submitReceipt(blrTask.id, blrTask.assignedTo, {
      amount: 16000,
      items: ['Masala Chai', 'Samosas'],
    });
    assert.equal(blrRes.task.budgetWarning, true);

    // Consolidated report with 1 INR = 0.12 NOK
    const report = core.getMonthlyReport(0.12);
    assert.equal(report.offices.oslo.spent, 1500);
    assert.equal(report.offices.bengaluru.spent, 16000);
    // 1500 NOK + (16000 * 0.12 = 1920 NOK) = 3420 NOK
    assert.equal(report.consolidatedTotalNOK, 3420);
  });
});