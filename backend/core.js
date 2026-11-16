const crypto = require('crypto');

class SnackCounterCore {
  constructor() {
    this.reset();
  }

  reset() {
    this.offices = {
      oslo: {
        id: 'oslo',
        name: 'Oslo',
        currency: 'NOK',
        monthlyBudget: 6000,
        typicalPurchase: '300–1,200 NOK',
        currentSpent: 0,
      },
      bengaluru: {
        id: 'bengaluru',
        name: 'Bengaluru',
        currency: 'INR',
        monthlyBudget: 15000,
        typicalPurchase: '500–3,000 INR',
        currentSpent: 0,
      },
    };

    // Includes hybrid statuses and visiting employees
    this.employees = [
      { id: 'emp-oslo-1', name: 'Astrid Lind', homeOffice: 'oslo', currentOffice: 'oslo', status: 'IN_OFFICE', isVolunteer: true, refillCount: 1 },
      { id: 'emp-oslo-2', name: 'Sander Berg', homeOffice: 'oslo', currentOffice: 'oslo', status: 'IN_OFFICE', isVolunteer: true, refillCount: 0 },
      { id: 'emp-oslo-3', name: 'Maja Holm', homeOffice: 'oslo', currentOffice: 'oslo', status: 'WFH', isVolunteer: true, refillCount: 0 },
      { id: 'emp-oslo-4', name: 'Henrik Dahl', homeOffice: 'oslo', currentOffice: 'bengaluru', status: 'IN_OFFICE', isVolunteer: true, refillCount: 0 }, // Visiting Bengaluru!

      { id: 'emp-blr-1', name: 'Achyuth M', homeOffice: 'bengaluru', currentOffice: 'bengaluru', status: 'IN_OFFICE', isVolunteer: true, refillCount: 1 },
      { id: 'emp-blr-2', name: 'Priya Nair', homeOffice: 'bengaluru', currentOffice: 'bengaluru', status: 'IN_OFFICE', isVolunteer: true, refillCount: 0 },
      { id: 'emp-blr-3', name: 'Rohan Kulkarni', homeOffice: 'bengaluru', currentOffice: 'bengaluru', status: 'HOLIDAY', isVolunteer: true, refillCount: 0 },
      { id: 'emp-blr-4', name: 'Sneha Rao', homeOffice: 'bengaluru', currentOffice: 'bengaluru', status: 'WFH', isVolunteer: true, refillCount: 0 },
    ];

    this.tasks = [];
    this.chatLog = [];
    this.hrClaims = [];
    this.snackAnalytics = { oslo: {}, bengaluru: {} };
    this.slaMinutes = 120; // 2-hour commitment window
  }

  _logChat(officeId, recipientId, recipientName, text, taskId = null, actionable = false) {
    const msg = {
      id: `msg-${crypto.randomBytes(3).toString('hex')}`,
      timestamp: new Date().toISOString(),
      officeId,
      recipientId,
      recipientName,
      text,
      taskId,
      actionable,
    };
    this.chatLog.unshift(msg);
    return msg;
  }

  setEmployeeStatus(employeeId, status, currentOffice = null) {
    const emp = this.employees.find((e) => e.id === employeeId);
    if (!emp) throw new Error('Employee not found');
    if (status) emp.status = status;
    if (currentOffice) emp.currentOffice = currentOffice;
    return emp;
  }

  selectNextVolunteer(officeId, excludeIds = []) {
    const candidates = this.employees.filter(
      (e) =>
        e.isVolunteer &&
        e.currentOffice === officeId &&
        e.status === 'IN_OFFICE' &&
        !excludeIds.includes(e.id)
    );

    if (candidates.length === 0) return null;

    // Fair rotation: pick volunteer with lowest refillCount
    candidates.sort((a, b) => a.refillCount - b.refillCount);
    return candidates[0];
  }

  triggerEmpty(officeId, now = new Date()) {
    const office = this.offices[officeId];
    if (!office) throw new Error('Invalid office ID');

    // Prevent duplicate active refills for the same counter
    const existingActive = this.tasks.find(
      (t) => t.officeId === officeId && ['ASSIGNED', 'COMMITTED'].includes(t.status)
    );
    if (existingActive) {
      throw new Error(`An active refill (${existingActive.id}) is already in progress for ${office.name}.`);
    }

    const volunteer = this.selectNextVolunteer(officeId);
    if (!volunteer) {
      this._logChat(officeId, 'channel', `#${officeId}-snacks`, `Alert: Snack box is empty, but no volunteers are currently in the ${office.name} office!`);
      throw new Error(`No eligible volunteers currently IN_OFFICE in ${office.name}`);
    }

    const task = {
      id: `refill-${crypto.randomBytes(3).toString('hex')}`,
      officeId,
      status: 'ASSIGNED',
      assignedTo: volunteer.id,
      assignedName: volunteer.name,
      attemptedVolunteers: [volunteer.id],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.slaMinutes * 60000).toISOString(),
      amount: null,
      currency: office.currency,
      items: [],
      receiptImage: null,
      hrClaimId: null,
      budgetWarning: false,
    };

    this.tasks.unshift(task);
    this._logChat(
      officeId,
      volunteer.id,
      volunteer.name,
      `Hey ${volunteer.name}! The ${office.name} snack box is empty. Can you restock today? (Typical: ${office.typicalPurchase})`,
      task.id,
      true
    );

    return task;
  }

  commitTask(taskId, employeeId, now = new Date()) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('Task not found');

    // Atomic concurrency lock check
    if (task.status !== 'ASSIGNED') {
      throw new Error(`Cannot commit: task is already ${task.status}`);
    }

    if (task.assignedTo !== employeeId) {
      throw new Error(`Unauthorized: task is currently assigned to ${task.assignedName}`);
    }

    // Check if SLA expired before user clicked
    if (now > new Date(task.expiresAt)) {
      this.escalateTask(taskId, 'SLA timeout expired', now);
      throw new Error('Task expired due to timeout and has been reassigned to another volunteer.');
    }

    task.status = 'COMMITTED';
    // Disable action buttons on previous chat prompt
    this.chatLog.forEach((m) => {
      if (m.taskId === taskId) m.actionable = false;
    });

    this._logChat(
      task.officeId,
      'channel',
      `#${task.officeId}-snacks`,
      `${task.assignedName} committed to restocking the ${this.offices[task.officeId].name} snack counter!`
    );

    return task;
  }

  escalateTask(taskId, reason = 'Declined by volunteer', now = new Date()) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'ASSIGNED') {
      throw new Error(`Only ASSIGNED tasks can be escalated (current: ${task.status})`);
    }

    // Close old chat prompt
    this.chatLog.forEach((m) => {
      if (m.taskId === taskId) m.actionable = false;
    });

    const nextVolunteer = this.selectNextVolunteer(task.officeId, task.attemptedVolunteers);
    if (!nextVolunteer) {
      task.status = 'EXPIRED';
      this._logChat(
        task.officeId,
        'channel',
        `#${task.officeId}-snacks`,
        `Refill ${task.id} (${reason}) could not be reassigned — no other volunteers available in office.`
      );
      return task;
    }

    // Reassign to next volunteer
    task.assignedTo = nextVolunteer.id;
    task.assignedName = nextVolunteer.name;
    task.attemptedVolunteers.push(nextVolunteer.id);
    task.expiresAt = new Date(now.getTime() + this.slaMinutes * 60000).toISOString();

    this._logChat(
      task.officeId,
      nextVolunteer.id,
      nextVolunteer.name,
      `Reassigned (${reason}): Hey ${nextVolunteer.name}, can you restock the ${this.offices[task.officeId].name} snack box?`,
      task.id,
      true
    );

    return task;
  }

  checkAndEscalateTimeouts(now = new Date()) {
    const expired = this.tasks.filter(
      (t) => t.status === 'ASSIGNED' && now > new Date(t.expiresAt)
    );
    return expired.map((t) => this.escalateTask(t.id, 'SLA timeout expired', now));
  }

  submitReceipt(taskId, employeeId, { amount, items = [], receiptImage = 'receipt_mock.jpg' }) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'COMMITTED') {
      throw new Error(`Task must be COMMITTED before submitting receipt (current: ${task.status})`);
    }
    if (task.assignedTo !== employeeId) {
      throw new Error('Only the committed volunteer can submit the receipt');
    }

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    const office = this.offices[task.officeId];
    const volunteer = this.employees.find((e) => e.id === employeeId);

    // Budget Check
    const projectedSpend = office.currentSpent + numericAmount;
    const exceedsBudget = projectedSpend > office.monthlyBudget;
    task.budgetWarning = exceedsBudget;

    // Update office spend & volunteer fairness counter
    office.currentSpent = projectedSpend;
    if (volunteer) volunteer.refillCount += 1;

    // Track snack popularity
    const cleanItems = Array.isArray(items)
      ? items.map((i) => i.trim()).filter(Boolean)
      : String(items).split(',').map((i) => i.trim()).filter(Boolean);

    cleanItems.forEach((item) => {
      const key = item.toLowerCase();
      this.snackAnalytics[task.officeId][key] = (this.snackAnalytics[task.officeId][key] || 0) + 1;
    });

    // External HR System API call simulation
    // Note: Employees are reimbursed in the currency of their payroll
    const payrollCurrency = volunteer && volunteer.homeOffice === 'oslo' ? 'NOK' : 'INR';
    const claim = {
      claimId: `HR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      taskId: task.id,
      employeeId,
      employeeName: task.assignedName,
      purchaseAmount: numericAmount,
      purchaseCurrency: office.currency,
      reimbursementCurrency: payrollCurrency,
      description: `Snack counter refill (${office.name}): ${cleanItems.join(', ') || 'Assorted snacks'}`,
      receiptImage,
      status: 'PENDING_HR_APPROVAL',
      submittedAt: new Date().toISOString(),
      approvedAt: null,
    };

    this.hrClaims.unshift(claim);

    task.amount = numericAmount;
    task.items = cleanItems;
    task.receiptImage = receiptImage;
    task.hrClaimId = claim.claimId;
    task.status = 'SUBMITTED_TO_HR';

    const warningText = exceedsBudget ? ' [BUDGET EXCEEDED - Flagged]' : '';
    this._logChat(
      task.officeId,
      employeeId,
      task.assignedName,
      `Receipt submitted for ${numericAmount} ${office.currency}${warningText}. HR Claim ${claim.claimId} created automatically.`
    );

    return { task, claim };
  }

  approveHrClaim(claimId) {
    const claim = this.hrClaims.find((c) => c.claimId === claimId);
    if (!claim) throw new Error('HR claim not found');
    if (claim.status === 'REIMBURSED') return claim;

    claim.status = 'REIMBURSED';
    claim.approvedAt = new Date().toISOString();

    const task = this.tasks.find((t) => t.id === claim.taskId);
    if (task) task.status = 'REIMBURSED';

    this._logChat(
      task ? task.officeId : 'oslo',
      claim.employeeId,
      claim.employeeName,
      `HR approved claim ${claim.claimId}! Reimbursement processed in ${claim.reimbursementCurrency}.`
    );

    return claim;
  }

  getMonthlyReport(inrToNokRate = 0.12) {
    const oslo = this.offices.oslo;
    const blr = this.offices.bengaluru;

    const blrInNok = Number((blr.currentSpent * inrToNokRate).toFixed(2));
    const totalNok = Number((oslo.currentSpent + blrInNok).toFixed(2));

    return {
      fxRateUsed: `1 INR = ${inrToNokRate} NOK`,
      offices: {
        oslo: {
          spent: oslo.currentSpent,
          budget: oslo.monthlyBudget,
          currency: oslo.currency,
          remaining: oslo.monthlyBudget - oslo.currentSpent,
          utilizationPct: Number(((oslo.currentSpent / oslo.monthlyBudget) * 100).toFixed(1)),
          topSnacks: this.snackAnalytics.oslo,
        },
        bengaluru: {
          spent: blr.currentSpent,
          budget: blr.monthlyBudget,
          currency: blr.currency,
          remaining: blr.monthlyBudget - blr.currentSpent,
          utilizationPct: Number(((blr.currentSpent / blr.monthlyBudget) * 100).toFixed(1)),
          topSnacks: this.snackAnalytics.bengaluru,
        },
      },
      consolidatedTotalNOK: totalNok,
    };
  }
}

module.exports = { SnackCounterCore };