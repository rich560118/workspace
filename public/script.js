const API_BASE = '/api';
const DAY_MS = 24 * 60 * 60 * 1000;
const STATUS_META = {
    '未開始': { label: '未開始', className: 'status-not-started' },
    '執行中': { label: '執行中', className: 'status-in-progress' },
    '結案': { label: '結案', className: 'status-done' }
};

const workItemForm = document.getElementById('workItemForm');
const workItemsList = document.getElementById('workItemsList');
const progressReportForm = document.getElementById('progressReportForm');
const progressReportModal = document.getElementById('progressReportModal');
const progressWorkItemSelect = document.getElementById('progressWorkItemSelect');
const progressReportsList = document.getElementById('progressReportsList');
const intervalSelect = document.getElementById('intervalSelect');
const ganttChart = document.getElementById('ganttChart');
const closeProgressReportModalButton = document.getElementById('closeProgressReportModal');
const progressModalSubtitle = document.getElementById('progressModalSubtitle');
const totalWorkItems = document.getElementById('totalWorkItems');
const activeWorkItems = document.getElementById('activeWorkItems');
const completedWorkItems = document.getElementById('completedWorkItems');
const totalActualHours = document.getElementById('totalActualHours');

let workItems = [];
let progressReports = [];

document.addEventListener('DOMContentLoaded', init);
workItemForm.addEventListener('submit', createWorkItem);
progressReportForm.addEventListener('submit', createProgressReport);
closeProgressReportModalButton.addEventListener('click', closeProgressReportModal);

if (intervalSelect) {
    intervalSelect.addEventListener('change', loadGanttChart);
}

if (progressReportModal) {
    progressReportModal.addEventListener('click', event => {
        if (event.target === progressReportModal) {
            closeProgressReportModal();
        }
    });
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && progressReportModal && !progressReportModal.hidden) {
        closeProgressReportModal();
    }
});

async function init() {
    setDateDefaults();
    await refreshData();
}

async function refreshData() {
    await Promise.all([fetchWorkItems(), fetchProgressReports()]);
    renderApp();
    await loadGanttChart();
}

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(payload?.error || '操作失敗，請稍後再試');
    }

    return payload;
}

async function fetchWorkItems() {
    try {
        workItems = await apiRequest('/work-items');
    } catch (error) {
        console.error('Error fetching work items:', error);
        workItems = [];
        showError('無法讀取工作項目');
    }
}

async function fetchProgressReports() {
    try {
        progressReports = await apiRequest('/progress-reports');
    } catch (error) {
        console.error('Error fetching progress reports:', error);
        progressReports = [];
        showError('無法讀取進度報告');
    }
}

async function createWorkItem(event) {
    event.preventDefault();

    const formData = new FormData(workItemForm);
    const workItem = {
        name: String(formData.get('workItemName') || '').trim(),
        projectMember: String(formData.get('projectMemberName') || '').trim(),
        startDate: formData.get('startDate'),
        endDate: formData.get('endDate')
    };

    const validationError = validateWorkItem(workItem);
    if (validationError) {
        showError(validationError);
        return;
    }

    try {
        await apiRequest('/work-items', {
            method: 'POST',
            body: JSON.stringify(workItem)
        });
        workItemForm.reset();
        setDateDefaults();
        await refreshData();
    } catch (error) {
        console.error('Error creating work item:', error);
        showError(error.message);
    }
}

async function updateWorkItem(id, updates) {
    try {
        await apiRequest(`/work-items/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
        await refreshData();
    } catch (error) {
        console.error('Error updating work item:', error);
        showError(error.message);
    }
}

async function deleteWorkItem(id) {
    const item = workItems.find(workItem => workItem.id === id);
    const name = item ? `「${item.name}」` : '此工作項目';

    if (!confirm(`確定要刪除${name}嗎？相關進度報告也會一併移除。`)) {
        return;
    }

    try {
        await apiRequest(`/work-items/${id}`, { method: 'DELETE' });
        await refreshData();
    } catch (error) {
        console.error('Error deleting work item:', error);
        showError(error.message);
    }
}

async function editWorkItem(id) {
    const item = workItems.find(workItem => workItem.id === id);
    if (!item) return;

    const newName = prompt('請輸入新的工作項目名稱:', item.name);
    if (newName === null) return;

    const newProjectMember = prompt('請輸入專案人員姓名:', item.projectMember || '');
    if (newProjectMember === null) return;

    const newStartDate = prompt('請輸入新的開始日期 (YYYY-MM-DD):', item.startDate);
    if (newStartDate === null) return;

    const newEndDate = prompt('請輸入新的結束日期 (YYYY-MM-DD):', item.endDate);
    if (newEndDate === null) return;

    const updates = {
        name: newName.trim(),
        projectMember: newProjectMember.trim(),
        startDate: newStartDate,
        endDate: newEndDate
    };

    const validationError = validateWorkItem(updates);
    if (validationError) {
        showError(validationError);
        return;
    }

    await updateWorkItem(id, updates);
}

async function createProgressReport(event) {
    event.preventDefault();

    const formData = new FormData(progressReportForm);
    const progressReport = {
        workItemId: Number(formData.get('progressWorkItemSelect')),
        reportMonth: formData.get('reportMonth'),
        actualHours: Number(formData.get('actualHours')),
        executionDate: formData.get('executionDate'),
        status: formData.get('status'),
        description: String(formData.get('progressDescription') || '').trim()
    };

    const validationError = validateProgressReport(progressReport);
    if (validationError) {
        showError(validationError);
        return;
    }

    try {
        await apiRequest('/progress-reports', {
            method: 'POST',
            body: JSON.stringify(progressReport)
        });
        progressReportForm.reset();
        setDateDefaults();
        closeProgressReportModal();
        await refreshData();
    } catch (error) {
        console.error('Error creating progress report:', error);
        showError(error.message);
    }
}

function openProgressReportModal(workItemId) {
    const item = workItems.find(workItem => workItem.id === workItemId);
    progressReportForm.reset();
    setDateDefaults();
    populateWorkItemSelect();

    if (item) {
        progressWorkItemSelect.value = String(item.id);
        progressModalSubtitle.textContent = item.projectMember
            ? `${item.name} - ${item.projectMember}`
            : item.name;
    } else {
        progressModalSubtitle.textContent = '';
    }

    progressReportModal.hidden = false;
    progressReportModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    document.getElementById('reportMonth').focus();
}

function closeProgressReportModal() {
    if (!progressReportModal || progressReportModal.hidden) return;

    progressReportModal.hidden = true;
    progressReportModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    progressModalSubtitle.textContent = '';
}

function renderApp() {
    renderSummary();
    renderWorkItems();
    renderProgressReports();
    populateWorkItemSelect();
}

function renderSummary() {
    const latestReports = getLatestReportsByWorkItem();
    const activeCount = workItems.filter(item => latestReports[item.id]?.status === '執行中').length;
    const completedCount = workItems.filter(item => latestReports[item.id]?.status === '結案').length;
    const hours = progressReports.reduce((sum, report) => sum + Number(report.actualHours || 0), 0);

    setText(totalWorkItems, workItems.length);
    setText(activeWorkItems, activeCount);
    setText(completedWorkItems, completedCount);
    setText(totalActualHours, formatHours(hours));
}

function renderWorkItems() {
    workItemsList.replaceChildren();

    if (workItems.length === 0) {
        workItemsList.appendChild(emptyMessage('目前沒有工作項目'));
        return;
    }

    const latestReports = getLatestReportsByWorkItem();
    const sortedItems = [...workItems].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    const fragment = document.createDocumentFragment();

    sortedItems.forEach(item => {
        const relatedReports = progressReports.filter(report => report.workItemId === item.id);
        const latestReport = latestReports[item.id];
        const totalHours = relatedReports.reduce((sum, report) => sum + Number(report.actualHours || 0), 0);

        const card = document.createElement('article');
        card.className = 'work-item';

        const header = document.createElement('div');
        header.className = 'item-header';

        const titleWrap = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = item.name;
        const dates = document.createElement('p');
        dates.className = 'item-subtitle';
        dates.textContent = `${formatDate(item.startDate)} - ${formatDate(item.endDate)}`;
        titleWrap.append(title, dates);

        header.append(titleWrap, statusBadge(latestReport?.status || '未開始'));

        const details = document.createElement('dl');
        details.className = 'metric-list';
        appendMetric(details, '專案人員', item.projectMember || '未設定');
        appendMetric(details, '累計時數', `${formatHours(totalHours)} 小時`);
        appendMetric(details, '填報筆數', `${relatedReports.length} 筆`);
        appendMetric(details, '填報月份', latestReport ? formatMonth(getReportMonth(latestReport)) : '尚未填報');

        const actions = document.createElement('div');
        actions.className = 'item-actions';
        actions.append(
            actionButton('填報', 'fill', () => openProgressReportModal(item.id)),
            actionButton('編輯', 'secondary', () => editWorkItem(item.id)),
            actionButton('刪除', 'danger', () => deleteWorkItem(item.id))
        );

        card.append(header, details, actions);
        fragment.appendChild(card);
    });

    workItemsList.appendChild(fragment);
}

function renderProgressReports() {
    progressReportsList.replaceChildren();

    if (progressReports.length === 0) {
        progressReportsList.appendChild(emptyMessage('目前沒有進度報告'));
        return;
    }

    const latestReports = getLatestReportsByWorkItem();
    const sortedWorkItemIds = Object.keys(latestReports).sort((a, b) => {
        const reportA = latestReports[a];
        const reportB = latestReports[b];
        return String(reportB.createdAt).localeCompare(String(reportA.createdAt));
    });
    const fragment = document.createDocumentFragment();

    sortedWorkItemIds.forEach(workItemId => {
        const workItem = workItems.find(item => item.id === Number(workItemId));
        const report = latestReports[workItemId];
        if (!workItem || !report) return;

        const card = document.createElement('article');
        card.className = 'progress-report';

        const header = document.createElement('div');
        header.className = 'item-header';

        const titleWrap = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = workItem.name;
        const subtitle = document.createElement('p');
        subtitle.className = 'item-subtitle';
        subtitle.textContent = `報告 #${report.id} · ${formatDateTime(report.createdAt)}`;
        titleWrap.append(title, subtitle);
        header.append(titleWrap, statusBadge(report.status));

        const details = document.createElement('dl');
        details.className = 'metric-list';
        appendMetric(details, '填報月份', formatMonth(getReportMonth(report)));
        appendMetric(details, '實際執行', `${formatHours(report.actualHours)} 小時`);
        appendMetric(details, '執行日期', formatDate(report.executionDate));
        appendMetric(details, '累計時數', `${formatHours(sumHoursForWorkItem(workItem.id))} 小時`);

        const description = document.createElement('p');
        description.className = 'report-description';
        description.textContent = report.description;

        card.append(header, details, description);
        fragment.appendChild(card);
    });

    progressReportsList.appendChild(fragment);
}

function populateWorkItemSelect() {
    const currentValue = progressWorkItemSelect.value;
    progressWorkItemSelect.replaceChildren();

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- 請選擇工作項目 --';
    progressWorkItemSelect.appendChild(defaultOption);

    workItems
        .slice()
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
        .forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.projectMember ? `${item.name} - ${item.projectMember}` : item.name;
            progressWorkItemSelect.appendChild(option);
        });

    if (currentValue && workItems.some(item => String(item.id) === currentValue)) {
        progressWorkItemSelect.value = currentValue;
    }
}

async function loadGanttChart() {
    if (!ganttChart) return;

    try {
        const interval = intervalSelect ? intervalSelect.value : 'weekly';
        const ganttData = await apiRequest(`/gantt-data?interval=${encodeURIComponent(interval)}`);
        renderGanttChart(ganttData);
    } catch (error) {
        console.error('Error loading Gantt chart data:', error);
        ganttChart.replaceChildren(emptyMessage('甘特圖資料讀取失敗'));
    }
}

function renderGanttChart(ganttData) {
    ganttChart.replaceChildren();

    const validData = ganttData
        .filter(item => isValidDateString(item.start) && isValidDateString(item.end))
        .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    if (validData.length === 0) {
        ganttChart.appendChild(emptyMessage('目前沒有工作項目顯示在甘特圖中'));
        return;
    }

    const timelineStart = toLocalDate(validData.reduce((min, item) => item.start < min ? item.start : min, validData[0].start));
    const latestEnd = toLocalDate(validData.reduce((max, item) => item.end > max ? item.end : max, validData[0].end));
    const timelineEnd = addDays(latestEnd, 1);
    const totalMs = Math.max(timelineEnd.getTime() - timelineStart.getTime(), DAY_MS);
    const interval = intervalSelect ? intervalSelect.value : 'weekly';
    const ticks = buildTicks(timelineStart, timelineEnd, interval);

    const legend = document.createElement('div');
    legend.className = 'gantt-legend';
    legend.append(
        legendItem('預計期程', 'planned'),
        legendItem('已完成比例', 'progress')
    );

    const board = document.createElement('div');
    board.className = 'gantt-chart-board';

    const header = document.createElement('div');
    header.className = 'gantt-row gantt-row-header';
    const headerLabel = document.createElement('div');
    headerLabel.className = 'gantt-label';
    headerLabel.textContent = '工作項目';
    const headerTimeline = document.createElement('div');
    headerTimeline.className = 'gantt-timeline gantt-timeline-header';
    renderTicks(headerTimeline, ticks, timelineStart, totalMs, interval, true);
    header.append(headerLabel, headerTimeline);
    board.appendChild(header);

    validData.forEach(item => {
        const row = document.createElement('div');
        row.className = 'gantt-row';

        const label = document.createElement('div');
        label.className = 'gantt-label';
        const name = document.createElement('strong');
        name.textContent = item.name;
        const meta = document.createElement('span');
        meta.textContent = `${formatDate(item.start)} - ${formatDate(item.end)} · ${item.latestStatus || '未開始'}`;
        label.append(name, meta);

        const timeline = document.createElement('div');
        timeline.className = 'gantt-timeline';
        renderTicks(timeline, ticks, timelineStart, totalMs, interval, false);

        const barStart = toLocalDate(item.start);
        const barEnd = addDays(toLocalDate(item.end), 1);
        const left = clamp(((barStart.getTime() - timelineStart.getTime()) / totalMs) * 100, 0, 100);
        const right = clamp(((barEnd.getTime() - timelineStart.getTime()) / totalMs) * 100, 0, 100);
        const width = Math.max(right - left, 1.4);
        const progress = clamp(Number(item.progress || 0), 0, 100);

        const plannedBar = document.createElement('div');
        plannedBar.className = 'gantt-bar gantt-bar-planned';
        plannedBar.style.left = `${left}%`;
        plannedBar.style.width = `${width}%`;
        plannedBar.title = `${item.name}: ${formatDate(item.start)} - ${formatDate(item.end)}, ${progress}%`;

        const progressBar = document.createElement('div');
        progressBar.className = 'gantt-bar-progress';
        progressBar.style.width = `${progress}%`;
        plannedBar.appendChild(progressBar);

        const progressText = document.createElement('span');
        progressText.className = 'gantt-bar-text';
        progressText.textContent = `${Math.round(progress)}%`;
        plannedBar.appendChild(progressText);

        timeline.appendChild(plannedBar);
        row.append(label, timeline);
        board.appendChild(row);
    });

    ganttChart.append(legend, board);
}

function renderTicks(container, ticks, start, totalMs, interval, showLabels) {
    ticks.forEach(tick => {
        const position = clamp(((tick.getTime() - start.getTime()) / totalMs) * 100, 0, 100);
        const line = document.createElement('div');
        line.className = 'gantt-tick';
        line.style.left = `${position}%`;

        if (showLabels) {
            const label = document.createElement('span');
            label.textContent = formatTickLabel(tick, interval);
            line.appendChild(label);
        }

        container.appendChild(line);
    });
}

function buildTicks(start, end, interval) {
    const ticks = [new Date(start)];
    let cursor = alignTick(start, interval);

    if (cursor.getTime() <= start.getTime()) {
        cursor = addInterval(cursor, interval);
    }

    while (cursor.getTime() < end.getTime()) {
        ticks.push(new Date(cursor));
        cursor = addInterval(cursor, interval);
    }

    ticks.push(new Date(end));
    return ticks;
}

function alignTick(date, interval) {
    const aligned = new Date(date);
    aligned.setHours(0, 0, 0, 0);

    if (interval === 'weekly') {
        const mondayOffset = (aligned.getDay() + 6) % 7;
        aligned.setDate(aligned.getDate() - mondayOffset);
        return aligned;
    }

    if (interval === 'monthly') {
        aligned.setDate(1);
        return aligned;
    }

    if (interval === 'quarterly') {
        aligned.setMonth(Math.floor(aligned.getMonth() / 3) * 3, 1);
        return aligned;
    }

    aligned.setMonth(0, 1);
    return aligned;
}

function addInterval(date, interval) {
    const next = new Date(date);

    if (interval === 'weekly') {
        next.setDate(next.getDate() + 7);
    } else if (interval === 'monthly') {
        next.setMonth(next.getMonth() + 1);
    } else if (interval === 'quarterly') {
        next.setMonth(next.getMonth() + 3);
    } else {
        next.setFullYear(next.getFullYear() + 1);
    }

    return next;
}

function formatTickLabel(date, interval) {
    if (interval === 'yearly') {
        return String(date.getFullYear());
    }

    if (interval === 'quarterly') {
        return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`;
    }

    if (interval === 'monthly') {
        return `${date.getFullYear()}/${date.getMonth() + 1}`;
    }

    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getLatestReportsByWorkItem() {
    return progressReports.reduce((latestReports, report) => {
        const workItemId = report.workItemId;
        const existing = latestReports[workItemId];

        if (!existing || String(report.createdAt).localeCompare(String(existing.createdAt)) > 0) {
            latestReports[workItemId] = report;
        }

        return latestReports;
    }, {});
}

function getReportMonth(report) {
    if (isValidMonthString(report?.reportMonth)) {
        return report.reportMonth;
    }

    if (isValidDateString(report?.executionDate)) {
        return report.executionDate.slice(0, 7);
    }

    return '';
}

function validateWorkItem(workItem) {
    if (!workItem.name) return '請輸入工作項目名稱';
    if (!workItem.projectMember) return '請輸入專案人員姓名';
    if (!isValidDateString(workItem.startDate) || !isValidDateString(workItem.endDate)) {
        return '請輸入有效的開始日期與結束日期';
    }
    if (toLocalDate(workItem.startDate) > toLocalDate(workItem.endDate)) {
        return '開始日期不可晚於結束日期';
    }
    return '';
}

function validateProgressReport(report) {
    if (!report.workItemId) return '請選擇工作項目';
    if (!isValidMonthString(report.reportMonth)) return '請選擇填報月份';
    if (!Number.isFinite(report.actualHours) || report.actualHours < 0) {
        return '請輸入有效的實際執行時間';
    }
    if (!isValidDateString(report.executionDate)) return '請輸入有效的實際執行日期';
    if (!STATUS_META[report.status]) return '請選擇執行情形';
    if (!report.description) return '請填寫進度說明';
    return '';
}

function appendMetric(container, labelText, valueText) {
    const label = document.createElement('dt');
    label.textContent = labelText;
    const value = document.createElement('dd');
    value.textContent = valueText;
    container.append(label, value);
}

function statusBadge(status) {
    const meta = STATUS_META[status] || STATUS_META['未開始'];
    const badge = document.createElement('span');
    badge.className = `status-badge ${meta.className}`;
    badge.textContent = meta.label;
    return badge;
}

function actionButton(label, variant, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${variant}`;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
}

function legendItem(label, type) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = `legend-swatch ${type}`;
    const text = document.createElement('span');
    text.textContent = label;
    item.append(swatch, text);
    return item;
}

function emptyMessage(message) {
    const element = document.createElement('p');
    element.className = 'no-items';
    element.textContent = message;
    return element;
}

function setDateDefaults() {
    const today = formatDateInput(new Date());
    const currentMonth = formatMonthInput(new Date());
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const executionDate = document.getElementById('executionDate');
    const reportMonth = document.getElementById('reportMonth');

    if (startDate && !startDate.value) startDate.value = today;
    if (endDate && !endDate.value) endDate.value = today;
    if (executionDate && !executionDate.value) executionDate.value = today;
    if (reportMonth && !reportMonth.value) reportMonth.value = currentMonth;
}

function setText(element, value) {
    if (element) {
        element.textContent = value;
    }
}

function showError(message) {
    alert(message);
}

function sumHoursForWorkItem(workItemId) {
    return progressReports
        .filter(report => report.workItemId === workItemId)
        .reduce((sum, report) => sum + Number(report.actualHours || 0), 0);
}

function isValidDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    return !Number.isNaN(toLocalDate(value).getTime());
}

function isValidMonthString(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    if (!match) return false;

    const month = Number(match[2]);
    return month >= 1 && month <= 12;
}

function toLocalDate(value) {
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(year, month - 1, day);
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function formatDate(value) {
    if (!isValidDateString(value)) return '未設定';
    return toLocalDate(value).toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function formatMonth(value) {
    if (!isValidMonthString(value)) return '未設定';
    const [year, month] = value.split('-');
    return `${year}/${month}`;
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '時間未設定';
    return date.toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateInput(date) {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
}

function formatMonthInput(date) {
    return formatDateInput(date).slice(0, 7);
}

function formatHours(value) {
    const number = Number(value || 0);
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
