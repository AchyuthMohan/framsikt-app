async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = isError ? 'toast error' : 'toast';
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

const STATUS_CYCLE = ['IN_OFFICE', 'WFH', 'HOLIDAY'];

async function toggleStatus(empId, currentStatus) {
  const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(currentStatus) + 1) % STATUS_CYCLE.length];
  try {
    await api(`/api/employees/${empId}/status`, 'POST', { status: next });
    render();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function triggerEmpty(officeId) {
  try {
    await api(`/api/offices/${officeId}/empty`, 'POST');
    showToast(`Triggered empty snack box alert for ${officeId.toUpperCase()}`);
    render();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function commitTask(taskId, employeeId) {
  try {
    await api(`/api/tasks/${taskId}/commit`, 'POST', { employeeId });
    showToast('Task locked & committed!');
    render();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function escalateTask(taskId, reason) {
  try {
    await api(`/api/tasks/${taskId}/escalate`, 'POST', { reason });
    showToast(`Task escalated (${reason})`);
    render();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function submitReceipt(e, taskId, employeeId) {
  e.preventDefault();
  const amount = document.getElementById(`amt-${taskId}`).value;
  const items = document.getElementById(`items-${taskId}`).value;
  try {
    await api(`/api/tasks/${taskId}/receipt`, 'POST', {
      employeeId,
      amount,
      items,
      receiptImage: `receipt_${Date.now()}.jpg`,
    });
    showToast('Receipt submitted & HR claim created!');
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function approveClaim(claimId) {
  try {
    await api(`/api/hr/claims/${claimId}/approve`, 'POST');
    showToast(`HR Claim ${claimId} reimbursed!`);
    render();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function render() {
  const state = await api('/api/state');

  // 1. Consolidated Management Report
  const r = state.report;
  document.getElementById('managementReport').innerHTML = `
    <div class="report-metric">
      <span>Oslo Monthly Spend</span>
      <strong>${r.offices.oslo.spent} / ${r.offices.oslo.budget} NOK (${r.offices.oslo.utilizationPct}%)</strong>
    </div>
    <div class="report-metric">
      <span>Bengaluru Monthly Spend</span>
      <strong>${r.offices.bengaluru.spent} / ${r.offices.bengaluru.budget} INR (${r.offices.bengaluru.utilizationPct}%)</strong>
    </div>
    <div class="report-metric">
      <span>Consolidated Management Total (${r.fxRateUsed})</span>
      <strong>${r.consolidatedTotalNOK} NOK</strong>
    </div>
  `;

  // 2. Office Cards
  const officesEl = document.getElementById('officesContainer');
  officesEl.innerHTML = Object.values(state.offices)
    .map((o) => {
      const pct = Math.min(100, (o.currentSpent / o.monthlyBudget) * 100);
      const over = o.currentSpent > o.monthlyBudget;
      return `
        <div class="office-card">
          <div class="office-header">
            <strong>${o.name} Counter</strong>
            <button onclick="triggerEmpty('${o.id}')">Mark Box Empty</button>
          </div>
          <div class="subtitle">Spent: ${o.currentSpent} / ${o.monthlyBudget} ${o.currency} (Typical: ${o.typicalPurchase})</div>
          <div class="progress-bar">
            <div class="progress-fill ${over ? 'over' : ''}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');

  // 3. Hybrid Volunteer Roster
  const rosterEl = document.getElementById('rosterContainer');
  rosterEl.innerHTML = state.employees
    .map(
      (emp) => `
      <div class="roster-item">
        <div>
          <strong>${emp.name}</strong>
          <span class="subtitle">(${emp.currentOffice.toUpperCase()} • ${emp.refillCount} refills)</span>
        </div>
        <button class="badge ${emp.status}" onclick="toggleStatus('${emp.id}', '${emp.status}')">
          ${emp.status}
        </button>
      </div>
    `
    )
    .join('');

  // 4. Active Committed Refills (Receipt Upload Form)
  const committedTasks = state.tasks.filter((t) => t.status === 'COMMITTED');
  document.getElementById('activeReceiptForm').innerHTML = committedTasks
    .map(
      (t) => `
      <form class="receipt-box" onsubmit="submitReceipt(event, '${t.id}', '${t.assignedTo}')">
        <strong>Upload Receipt — ${t.assignedName} (${t.officeId.toUpperCase()})</strong>
        <input id="amt-${t.id}" type="number" step="0.01" placeholder="Amount in ${t.currency}" required />
        <input id="items-${t.id}" type="text" placeholder="Snacks bought (e.g. Coffee, Nuts, Fruit)" required />
        <button type="submit" class="btn-success">Submit Receipt to HR</button>
      </form>
    `
    )
    .join('');

  // 5. Simulated Chat Feed
  document.getElementById('chatFeed').innerHTML = state.chatLog
    .map((m) => {
      const actions = m.actionable
        ? `<div class="chat-actions">
            <button class="btn-success" onclick="commitTask('${m.taskId}', '${m.recipientId}')">Accept ("I'll do it")</button>
            <button class="btn-warning" onclick="escalateTask('${m.taskId}', 'Declined by volunteer')">Decline</button>
            <button class="btn-danger" onclick="escalateTask('${m.taskId}', '2h SLA Timeout')">Simulate Timeout</button>
          </div>`
        : '';
      return `
        <div class="chat-msg">
          <div class="chat-meta">
            <span>To: <strong>${m.recipientName}</strong> (#${m.officeId})</span>
            <span>${new Date(m.timestamp).toLocaleTimeString()}</span>
          </div>
          <div>${m.text}</div>
          ${actions}
        </div>
      `;
    })
    .join('');

  // 6. Simulated HR System Claims
  document.getElementById('hrClaimsList').innerHTML =
    state.hrClaims.length === 0
      ? '<p class="subtitle">No reimbursement claims submitted yet.</p>'
      : state.hrClaims
          .map(
            (c) => `
        <div class="claim-card">
          <div class="office-header">
            <strong>${c.claimId} — ${c.employeeName}</strong>
            <span class="badge ${c.status === 'REIMBURSED' ? 'IN_OFFICE' : 'WFH'}">${c.status}</span>
          </div>
          <div>Spent: ${c.purchaseAmount} ${c.purchaseCurrency} → Payroll Payout: <strong>${c.reimbursementCurrency}</strong></div>
          <div class="subtitle">${c.description}</div>
          ${
            c.status !== 'REIMBURSED'
              ? `<button style="margin-top:6px" class="btn-success" onclick="approveClaim('${c.claimId}')">Simulate HR Approval (1-10d)</button>`
              : ''
          }
        </div>
      `
          )
          .join('');

  // 7. Popular Snacks Analytics
  const stats = state.report.offices;
  const formatSnacks = (obj) =>
    Object.entries(obj)
      .map(([k, v]) => `${k} (${v})`)
      .join(', ') || 'None logged yet';

  document.getElementById('snackStats').innerHTML = `
    <p class="subtitle"><strong>Oslo:</strong> ${formatSnacks(stats.oslo.topSnacks)}</p>
    <p class="subtitle"><strong>Bengaluru:</strong> ${formatSnacks(stats.bengaluru.topSnacks)}</p>
  `;
}

document.getElementById('resetBtn').addEventListener('click', async () => {
  await api('/api/reset', 'POST');
  showToast('Demo state reset');
  render();
});

render();