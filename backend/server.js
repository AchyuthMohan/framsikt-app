const express = require('express');
const path = require('path');
const { SnackCounterCore } = require('./core');

const app = express();
const core = new SnackCounterCore();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Get full system state
app.get('/api/state', (req, res) => {
  res.json({
    offices: core.offices,
    employees: core.employees,
    tasks: core.tasks,
    chatLog: core.chatLog,
    hrClaims: core.hrClaims,
    report: core.getMonthlyReport(),
  });
});

// Update employee hybrid status or visiting office
app.post('/api/employees/:id/status', (req, res) => {
  try {
    const { status, currentOffice } = req.body;
    const emp = core.setEmployeeStatus(req.params.id, status, currentOffice);
    res.json(emp);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Trigger "Box Empty" for an office
app.post('/api/offices/:officeId/empty', (req, res) => {
  try {
    const task = core.triggerEmpty(req.params.officeId);
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Volunteer commits to refill
app.post('/api/tasks/:taskId/commit', (req, res) => {
  try {
    const { employeeId } = req.body;
    const task = core.commitTask(req.params.taskId, employeeId);
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Volunteer declines or simulates timeout escalation
app.post('/api/tasks/:taskId/escalate', (req, res) => {
  try {
    const { reason } = req.body;
    const task = core.escalateTask(req.params.taskId, reason || 'Declined by volunteer');
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Submit receipt & create HR claim
app.post('/api/tasks/:taskId/receipt', (req, res) => {
  try {
    const { employeeId, amount, items, receiptImage } = req.body;
    const result = core.submitReceipt(req.params.taskId, employeeId, {
      amount,
      items,
      receiptImage,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Simulate HR approving a reimbursement claim
app.post('/api/hr/claims/:claimId/approve', (req, res) => {
  try {
    const claim = core.approveHrClaim(req.params.claimId);
    res.json(claim);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reset demo state
app.post('/api/reset', (req, res) => {
  core.reset();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Snack Counter MVP running at http://localhost:${PORT}`);
});