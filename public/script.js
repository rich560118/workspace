const API_BASE = '/api';
const STORAGE_KEY = 'execution-progress-data-v1';
let useStaticData = shouldUseStaticData();

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
const progressReportTitle = document.getElementById('progressReportTitle');
const progressWorkItemSelect = document.getElementById('progressWorkItemSelect');
const progressReportSubmit = document.getElementById('progressReportSubmit');
const progressReportsList = document.getElementById('progressReportsList');
const progressReportMonthFilter = document.getElementById('progressReportMonthFilter');
const clearProgressReportMonthFilter = document.getElementById('clearProgressReportMonthFilter');
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
let editingProgressReportId = null;
let progressReportMonthFilterTouched = false;

document.addEventListener('DOMContentLoaded', init);
workItemForm.addEventListener('submit', createWorkItem);
progressReportForm.addEventListener('submit', createProgressReport);
closeProgressReportModalButton.addEventListener('click', closeProgressReportModal);

if (intervalSelect) {
    intervalSelect.addEventListener('change', loadGanttChart);
}

if (progressReportMonthFilter) {
    progressReportMonthFilter.addEventListener('change', () => {
        progressReportMonthFilterTouched = true;
        renderProgressReports();
        updateProgressReportExportLinks();
    });
}

if (clearProgressReportMonthFilter) {
    clearProgressReportMonthFilter.addEventListener('click', () => {
        progressReportMonthFilterTouched = true;
        progressReportMonthFilter.value = '';
        renderProgressReports();
        updateProgressReportExportLinks();
    });
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
    setupExportLinks();
    updateStaticUiMode();
    setDateDefaults();
    await refreshData();
}

async function refreshData() {
    await Promise.all([fetchWorkItems(), fetchProgressReports()]);
    renderApp();
    await loadGanttChart();
}

async function apiRequest(path, options = {}) {
    if (useStaticData) {
        return localApiRequest(path, options);
    }

    let response;

    try {
        response = await fetch(`${API_BASE}${path}`, {
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            ...options
        });
    } catch (error) {
        useStaticData = true;
        updateStaticUiMode();
        return localApiRequest(path, options);
    }

    if (response.status === 404 || response.status === 405) {
        useStaticData = true;
        updateStaticUiMode();
        return localApiRequest(path, options);
    }

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

function shouldUseStaticData() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');

    if (mode === 'api') return false;
    if (mode === 'static') return true;

    return window.location.protocol === 'file:'
        || window.location.hostname === 'github.io'
        || window.location.hostname.endsWith('.github.io');
}

function defaultData() {
    return {
        workItems: [],
        progressReports: []
    };
}

function normalizeData(data) {
    return {
        workItems: Array.isArray(data?.workItems) ? data.workItems : [],
        progressReports: Array.isArray(data?.progressReports) ? data.progressReports : []
    };
}

function readLocalData() {
    try {
        const rawData = localStorage.getItem(STORAGE_KEY);
        return normalizeData(rawData ? JSON.parse(rawData) : defaultData());
    } catch (error) {
        console.error('Error reading local data:', error);
        return defaultData();
    }
}

function saveLocalData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
}

function parseRequestBody(options) {
    try {
        return options.body ? JSON.parse(options.body) : {};
    } catch (error) {
        return {};
    }
}

function getNextId(items) {
    return Math.max(0, ...items.map(item => Number(item.id) || 0)) + 1;
}

async function localApiRequest(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const pathname = path.split('?')[0];
    const data = readLocalData();
    const body = parseRequestBody(options);
    const now = new Date().toISOString();

    if (pathname === '/work-items' && method === 'GET') {
        return data.workItems;
    }

    if (pathname === '/work-items' && method === 'POST') {
        const newItem = {
            ...body,
            id: getNextId(data.workItems),
            createdAt: now,
            updatedAt: now
        };
        data.workItems.push(newItem);
        saveLocalData(data);
        return newItem;
    }

    const workItemMatch = /^\/work-items\/(\d+)$/.exec(pathname);
    if (workItemMatch && method === 'PUT') {
        const id = Number(workItemMatch[1]);
        const item = data.workItems.find(workItem => workItem.id === id);
        if (!item) {
            throw new Error('Work item not found');
        }

        Object.assign(item, body, {
            updatedAt: now
        });
        saveLocalData(data);
        return item;
    }

    if (workItemMatch && method === 'DELETE') {
        const id = Number(workItemMatch[1]);
        const itemIndex = data.workItems.findIndex(workItem => workItem.id === id);
        if (itemIndex === -1) {
            throw new Error('Work item not found');
        }

        const [deletedItem] = data.workItems.splice(itemIndex, 1);
        data.progressReports = data.progressReports.filter(report => report.workItemId !== id);
        saveLocalData(data);
        return deletedItem;
    }

    if (pathname === '/progress-reports' && method === 'GET') {
        return data.progressReports;
    }

    if (pathname === '/progress-reports' && method === 'POST') {
        const workItem = data.workItems.find(item => item.id === Number(body.workItemId));
        if (!workItem) {
            throw new Error('找不到指定的工作項目');
        }

        const existingReport = data.progressReports
            .filter(report => report.workItemId === Number(body.workItemId) && getReportMonth(report) === body.reportMonth)
            .reduce((latest, report) => {
                if (!latest || compareReports(report, latest) > 0) return report;
                return latest;
            }, null);

        if (existingReport) {
            Object.assign(existingReport, body, {
                workItemId: Number(body.workItemId),
                actualHours: Number(body.actualHours || 0),
                updatedAt: now
            });
            saveLocalData(data);
            return existingReport;
        }

        const newReport = {
            ...body,
            workItemId: Number(body.workItemId),
            actualHours: Number(body.actualHours || 0),
            id: getNextId(data.progressReports),
            createdAt: now
        };
        data.progressReports.push(newReport);
        saveLocalData(data);
        return newReport;
    }

    const progressReportMatch = /^\/progress-reports\/(\d+)$/.exec(pathname);
    if (progressReportMatch && method === 'PUT') {
        const id = Number(progressReportMatch[1]);
        const report = data.progressReports.find(item => item.id === id);
        const workItem = data.workItems.find(item => item.id === Number(body.workItemId));

        if (!report) {
            throw new Error('找不到指定的進度報告');
        }

        if (!workItem) {
            throw new Error('找不到指定的工作項目');
        }

        Object.assign(report, body, {
            workItemId: Number(body.workItemId),
            actualHours: Number(body.actualHours || 0),
            updatedAt: now
        });
        saveLocalData(data);
        return report;
    }

    const reportsMatch = /^\/progress-reports\/work-item\/(\d+)$/.exec(pathname);
    if (reportsMatch && method === 'GET') {
        const workItemId = Number(reportsMatch[1]);
        return data.progressReports.filter(report => report.workItemId === workItemId);
    }

    if (pathname === '/gantt-data' && method === 'GET') {
        return buildGanttDataFromState(data);
    }

    throw new Error('操作失敗，請稍後再試');
}

function setupExportLinks() {
    document.querySelectorAll('[data-export]').forEach(link => {
        link.addEventListener('click', handleExportClick);
    });
}

function updateStaticUiMode() {
    document.querySelectorAll('[data-export$="pptx"]').forEach(link => {
        if (useStaticData) {
            link.classList.add('is-disabled');
            link.title = 'GitHub Pages 靜態版不支援 PPT 匯出';
            link.removeAttribute('download');
        } else {
            link.classList.remove('is-disabled');
            link.title = '';
            link.setAttribute('download', '');
        }
    });
    updateProgressReportExportLinks();
}

function updateProgressReportExportLinks() {
    const reportMonth = getSelectedProgressReportMonth();
    const query = reportMonth ? `?reportMonth=${encodeURIComponent(reportMonth)}` : '';
    const svgLink = document.querySelector('[data-export="progress-reports-svg"]');
    const pptxLink = document.querySelector('[data-export="progress-reports-pptx"]');

    if (svgLink) {
        svgLink.href = `api/export/progress-reports.svg${query}`;
    }

    if (pptxLink) {
        pptxLink.href = `api/export/progress-reports.pptx${query}`;
    }
}

function handleExportClick(event) {
    if (!useStaticData) return;

    event.preventDefault();

    const exportType = event.currentTarget.dataset.export;
    if (exportType.endsWith('pptx')) {
        showError('GitHub Pages 靜態版不支援 PPT 匯出；若需要 PPT，請使用 Flask 或 Render 版本。');
        return;
    }

    const data = {
        workItems,
        progressReports
    };
    const svg = exportType === 'gantt-svg'
        ? buildGanttSvg(data)
        : buildProgressReportsSvg(data, getSelectedProgressReportMonth());
    const filename = exportType === 'gantt-svg'
        ? 'gantt-chart.svg'
        : 'progress-reports.svg';

    downloadTextFile(filename, svg, 'image/svg+xml;charset=utf-8');
}

function downloadTextFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
        const existingReport = editingProgressReportId
            ? null
            : findProgressReportForWorkItemMonth(progressReport.workItemId, progressReport.reportMonth);
        const reportIdToUpdate = editingProgressReportId || existingReport?.id;
        const savedReport = await apiRequest(
            reportIdToUpdate ? `/progress-reports/${reportIdToUpdate}` : '/progress-reports',
            {
                method: reportIdToUpdate ? 'PUT' : 'POST',
                body: JSON.stringify(progressReport)
            }
        );
        if (progressReportMonthFilter) {
            progressReportMonthFilterTouched = true;
            progressReportMonthFilter.value = getReportMonth(savedReport) || progressReport.reportMonth;
        }
        progressReportForm.reset();
        setDateDefaults();
        closeProgressReportModal();
        await refreshData();
    } catch (error) {
        console.error('Error creating progress report:', error);
        showError(error.message);
    }
}

function openProgressReportModal(workItemId, reportId = null, defaultReportMonth = '') {
    const report = reportId
        ? progressReports.find(progressReport => progressReport.id === Number(reportId))
        : null;
    const item = workItems.find(workItem => workItem.id === Number(report?.workItemId || workItemId));
    editingProgressReportId = report ? report.id : null;
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

    if (defaultReportMonth && isValidMonthString(defaultReportMonth)) {
        document.getElementById('reportMonth').value = defaultReportMonth;
    }

    if (report) {
        progressReportTitle.textContent = '修正填報';
        progressReportSubmit.textContent = '儲存修正';
        progressWorkItemSelect.value = String(report.workItemId);
        document.getElementById('reportMonth').value = getReportMonth(report);
        document.getElementById('actualHours').value = report.actualHours ?? 0;
        document.getElementById('executionDate').value = report.executionDate || '';
        document.getElementById('status').value = report.status || '';
        document.getElementById('progressDescription').value = report.description || '';

        if (item) {
            const itemText = item.projectMember ? `${item.name} - ${item.projectMember}` : item.name;
            progressModalSubtitle.textContent = `${itemText} · ${formatMonth(getReportMonth(report))}`;
        }
    } else {
        progressReportTitle.textContent = '填報執行進度';
        progressReportSubmit.textContent = '送出填報';
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
    progressReportTitle.textContent = '填報執行進度';
    progressReportSubmit.textContent = '送出填報';
    editingProgressReportId = null;
}

function renderApp() {
    syncProgressReportMonthFilterDefault();
    updateProgressReportExportLinks();
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
        const correctReportButton = actionButton('修正填報', 'secondary', () => openProgressReportModal(item.id, latestReport?.id));
        correctReportButton.disabled = !latestReport;
        correctReportButton.title = latestReport ? '修正最近一筆填報' : '尚無填報可修正';
        actions.append(
            actionButton('填報', 'fill', () => openProgressReportModal(item.id)),
            correctReportButton,
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
    const selectedMonth = getSelectedProgressReportMonth();

    if (selectedMonth) {
        if (workItems.length === 0) {
            progressReportsList.appendChild(emptyMessage('目前沒有工作項目'));
            return;
        }

        const reportsInMonth = progressReports.filter(report => getReportMonth(report) === selectedMonth);
        const reportsByWorkItem = getLatestReportsByWorkItem(reportsInMonth);
        const fragment = document.createDocumentFragment();

        workItems
            .slice()
            .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
            .forEach(workItem => {
                fragment.appendChild(renderProgressReportCard(
                    workItem,
                    reportsByWorkItem[workItem.id],
                    selectedMonth
                ));
            });

        progressReportsList.appendChild(fragment);
        return;
    }

    if (progressReports.length === 0) {
        progressReportsList.appendChild(emptyMessage('目前沒有進度報告'));
        return;
    }

    const latestReports = getLatestReportsByWorkItem();
    const sortedWorkItemIds = Object.keys(latestReports).sort((a, b) => {
        const reportA = latestReports[a];
        const reportB = latestReports[b];
        return compareReports(reportB, reportA);
    });
    const fragment = document.createDocumentFragment();

    sortedWorkItemIds.forEach(workItemId => {
        const workItem = workItems.find(item => item.id === Number(workItemId));
        const report = latestReports[workItemId];
        if (!workItem || !report) return;

        fragment.appendChild(renderProgressReportCard(workItem, report));
    });

    progressReportsList.appendChild(fragment);
}

function renderProgressReportCard(workItem, report, selectedMonth = '') {
    const card = document.createElement('article');
    card.className = 'progress-report';

    const header = document.createElement('div');
    header.className = 'item-header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = workItem.name;
    const subtitle = document.createElement('p');
    subtitle.className = 'item-subtitle';
    subtitle.textContent = report
        ? `報告 #${report.id} · ${formatDateTime(report.updatedAt || report.createdAt)}`
        : `${formatMonth(selectedMonth)} 尚未填報`;
    titleWrap.append(title, subtitle);
    header.append(titleWrap, statusBadge(report?.status || '未開始'));

    const details = document.createElement('dl');
    details.className = 'metric-list';
    appendMetric(details, '填報月份', report ? formatMonth(getReportMonth(report)) : formatMonth(selectedMonth));
    appendMetric(details, '實際執行', report ? `${formatHours(report.actualHours)} 小時` : '尚未填報');
    appendMetric(details, '執行日期', report ? formatDate(report.executionDate) : '尚未填報');
    appendMetric(
        details,
        selectedMonth ? '本月時數' : '累計時數',
        `${formatHours(sumHoursForWorkItem(workItem.id, selectedMonth))} 小時`
    );

    const description = document.createElement('p');
    description.className = 'report-description';
    description.textContent = report ? report.description : '此月份尚未填報。';

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    if (report) {
        actions.appendChild(actionButton('修正', 'secondary', () => openProgressReportModal(workItem.id, report.id)));
    } else if (selectedMonth) {
        actions.appendChild(actionButton('填報', 'fill', () => openProgressReportModal(workItem.id, null, selectedMonth)));
    }

    card.append(header, details, description);
    if (actions.childElementCount > 0) {
        card.appendChild(actions);
    }

    return card;
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

function getLatestReportsByWorkItem(reports = progressReports) {
    return reports.reduce((latestReports, report) => {
        const workItemId = report.workItemId;
        const existing = latestReports[workItemId];

        if (!existing || compareReports(report, existing) > 0) {
            latestReports[workItemId] = report;
        }

        return latestReports;
    }, {});
}

function compareReports(reportA, reportB) {
    const monthCompare = String(getReportMonth(reportA)).localeCompare(String(getReportMonth(reportB)));
    if (monthCompare !== 0) return monthCompare;

    return String(reportA?.updatedAt || reportA?.createdAt || '')
        .localeCompare(String(reportB?.updatedAt || reportB?.createdAt || ''));
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

function getSelectedProgressReportMonth() {
    const value = progressReportMonthFilter?.value || '';
    return isValidMonthString(value) ? value : '';
}

function syncProgressReportMonthFilterDefault() {
    if (!progressReportMonthFilter || progressReportMonthFilterTouched || progressReportMonthFilter.value) {
        return;
    }

    const latestMonth = getLatestReportMonth(progressReports);
    if (latestMonth) {
        progressReportMonthFilter.value = latestMonth;
    }
}

function getLatestReportMonth(reports) {
    const latestReport = reports.reduce((latest, report) => {
        if (!getReportMonth(report)) return latest;
        if (!latest || compareReports(report, latest) > 0) return report;
        return latest;
    }, null);

    return latestReport ? getReportMonth(latestReport) : '';
}

function findProgressReportForWorkItemMonth(workItemId, reportMonth) {
    return progressReports
        .filter(report => report.workItemId === Number(workItemId) && getReportMonth(report) === reportMonth)
        .reduce((latest, report) => {
            if (!latest || compareReports(report, latest) > 0) return report;
            return latest;
        }, null);
}

function buildGanttDataFromState(data) {
    const latestReports = data.progressReports.reduce((latestReports, report) => {
        const workItemId = report.workItemId;
        const existing = latestReports[workItemId];

        if (!existing || compareReports(report, existing) > 0) {
            latestReports[workItemId] = report;
        }

        return latestReports;
    }, {});

    return data.workItems.map(workItem => {
        const relatedReports = data.progressReports.filter(report => report.workItemId === workItem.id);
        const latestReport = latestReports[workItem.id];
        const actualHours = relatedReports.reduce(
            (sum, report) => sum + Number(report.actualHours || 0),
            0
        );

        return {
            id: workItem.id,
            name: workItem.name || '',
            projectMember: workItem.projectMember || '',
            start: workItem.startDate || '',
            end: workItem.endDate || '',
            progress: calculateProgress(workItem, latestReport),
            actualHours,
            latestStatus: latestReport?.status || '未開始',
            latestReportMonth: latestReport ? getReportMonth(latestReport) : '',
            latestExecutionDate: latestReport?.executionDate || '',
            latestDescription: latestReport?.description || ''
        };
    });
}

function calculateProgress(workItem, latestReport) {
    if (!latestReport) return 0;

    if (latestReport.status === '結案') return 100;
    if (latestReport.status === '未開始') return 0;
    if (latestReport.status !== '執行中') return 0;
    if (!isValidDateString(workItem.startDate) || !isValidDateString(workItem.endDate)) return 0;

    const start = toLocalDate(workItem.startDate);
    const end = toLocalDate(workItem.endDate);
    const executionDate = isValidDateString(latestReport.executionDate)
        ? toLocalDate(latestReport.executionDate)
        : new Date();

    if (end <= start) {
        return executionDate >= end ? 100 : 0;
    }

    const totalDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    const elapsedDays = Math.round((executionDate.getTime() - start.getTime()) / DAY_MS) + 1;
    return clamp(Math.round((elapsedDays / totalDays) * 1000) / 10, 0, 100);
}

function svgText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function progressExportRows(data, reportMonth = '') {
    const reports = reportMonth
        ? data.progressReports.filter(report => getReportMonth(report) === reportMonth)
        : data.progressReports;
    const latestReports = reports.reduce((latestReports, report) => {
        const workItemId = report.workItemId;
        const existing = latestReports[workItemId];

        if (!existing || compareReports(report, existing) > 0) {
            latestReports[workItemId] = report;
        }

        return latestReports;
    }, {});

    return data.workItems
        .slice()
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
        .map(workItem => {
            const report = latestReports[workItem.id];
            const actualHours = reports
                .filter(item => item.workItemId === workItem.id)
                .reduce((sum, item) => sum + Number(item.actualHours || 0), 0);

            return {
                name: workItem.name || '',
                projectMember: workItem.projectMember || '',
                reportMonth: report ? formatMonth(getReportMonth(report)) : reportMonth ? formatMonth(reportMonth) : '尚未填報',
                actualHours: `${formatHours(actualHours)} 小時`,
                executionDate: report ? formatDate(report.executionDate) : '尚未填報',
                status: report?.status || '未開始',
                description: report?.description || ''
            };
        });
}

function buildProgressReportsSvg(data, reportMonth = '') {
    const rows = progressExportRows(data, reportMonth);
    const width = 1400;
    const rowHeight = 126;
    const height = 150 + Math.max(rows.length, 1) * rowHeight;
    const parts = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        '<rect width="100%" height="100%" fill="#f4f6f8"/>',
        '<text x="40" y="60" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="34" font-weight="700" fill="#202a35">進度報告列表</text>',
        `<text x="40" y="96" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="16" fill="#667789">匯出時間：${new Date().toLocaleString('zh-TW')}</text>`
    ];

    if (rows.length === 0) {
        parts.push(
            '<rect x="40" y="130" width="1320" height="100" rx="10" fill="#ffffff" stroke="#dbe3ea"/>',
            '<text x="700" y="188" text-anchor="middle" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="22" fill="#667789">目前沒有進度報告</text>'
        );
    } else {
        rows.forEach((row, index) => {
            const y = 130 + index * rowHeight;
            const statusFill = row.status === '結案' ? '#e0f2e8' : row.status === '執行中' ? '#dbeef5' : '#fff3d6';
            const statusText = row.status === '結案' ? '#2f855a' : row.status === '執行中' ? '#19556a' : '#b7791f';
            const description = row.description.length > 64
                ? `${row.description.slice(0, 64)}...`
                : row.description;

            parts.push(
                `<rect x="40" y="${y}" width="1320" height="104" rx="10" fill="#ffffff" stroke="#dbe3ea"/>`,
                `<text x="70" y="${y + 34}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="22" font-weight="700" fill="#202a35">${svgText(row.name)}</text>`,
                `<rect x="1200" y="${y + 18}" width="110" height="30" rx="15" fill="${statusFill}"/>`,
                `<text x="1255" y="${y + 39}" text-anchor="middle" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="15" font-weight="700" fill="${statusText}">${svgText(row.status)}</text>`,
                `<text x="70" y="${y + 66}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="15" fill="#667789">專案人員</text>`,
                `<text x="70" y="${y + 90}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="18" font-weight="700" fill="#202a35">${svgText(row.projectMember || '未設定')}</text>`,
                `<text x="250" y="${y + 66}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="15" fill="#667789">填報月份</text>`,
                `<text x="250" y="${y + 90}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="18" font-weight="700" fill="#202a35">${svgText(row.reportMonth)}</text>`,
                `<text x="430" y="${y + 66}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="15" fill="#667789">累計時數</text>`,
                `<text x="430" y="${y + 90}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="18" font-weight="700" fill="#202a35">${svgText(row.actualHours)}</text>`,
                `<text x="610" y="${y + 66}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="15" fill="#667789">執行日期</text>`,
                `<text x="610" y="${y + 90}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="18" font-weight="700" fill="#202a35">${svgText(row.executionDate)}</text>`,
                `<text x="800" y="${y + 66}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="15" fill="#667789">進度說明</text>`,
                `<text x="800" y="${y + 90}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="17" fill="#202a35">${svgText(description || '未填寫')}</text>`
            );
        });
    }

    parts.push('</svg>');
    return parts.join('\n');
}

function buildGanttSvg(data) {
    const items = buildGanttDataFromState(data)
        .filter(item => isValidDateString(item.start) && isValidDateString(item.end))
        .sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const width = 1400;
    const rowHeight = 74;
    const height = 150 + Math.max(items.length, 1) * rowHeight;
    const timelineX = 350;
    const timelineWidth = 980;
    const parts = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        '<rect width="100%" height="100%" fill="#f4f6f8"/>',
        '<text x="40" y="60" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="34" font-weight="700" fill="#202a35">專案甘特圖</text>',
        `<text x="40" y="96" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="16" fill="#667789">匯出時間：${new Date().toLocaleString('zh-TW')}</text>`
    ];

    if (items.length === 0) {
        parts.push(
            '<rect x="40" y="130" width="1320" height="100" rx="10" fill="#ffffff" stroke="#dbe3ea"/>',
            '<text x="700" y="188" text-anchor="middle" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="22" fill="#667789">目前沒有工作項目</text>',
            '</svg>'
        );
        return parts.join('\n');
    }

    const start = toLocalDate(items.reduce((min, item) => item.start < min ? item.start : min, items[0].start));
    const end = toLocalDate(items.reduce((max, item) => item.end > max ? item.end : max, items[0].end));
    const totalDays = Math.max(Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1, 1);

    parts.push(
        `<rect x="40" y="125" width="1320" height="${height - 155}" rx="10" fill="#ffffff" stroke="#dbe3ea"/>`,
        `<line x1="${timelineX}" y1="125" x2="${timelineX}" y2="${height - 30}" stroke="#dbe3ea"/>`
    );

    for (let tickIndex = 0; tickIndex <= 5; tickIndex += 1) {
        const x = timelineX + (timelineWidth * tickIndex / 5);
        const tickDate = addDays(start, Math.round(((totalDays - 1) * tickIndex) / 5));
        parts.push(
            `<line x1="${x.toFixed(1)}" y1="125" x2="${x.toFixed(1)}" y2="${height - 30}" stroke="#e6edf2"/>`,
            `<text x="${(x + 4).toFixed(1)}" y="148" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="13" fill="#667789">${formatDateInput(tickDate).replace(/-/g, '/')}</text>`
        );
    }

    items.forEach((item, index) => {
        const y = 170 + index * rowHeight;
        const itemStart = toLocalDate(item.start);
        const itemEnd = toLocalDate(item.end);
        const left = timelineX + (Math.round((itemStart.getTime() - start.getTime()) / DAY_MS) / totalDays) * timelineWidth;
        const right = timelineX + ((Math.round((itemEnd.getTime() - start.getTime()) / DAY_MS) + 1) / totalDays) * timelineWidth;
        const barWidth = Math.max(right - left, 12);
        const progressWidth = Math.max(barWidth * Number(item.progress || 0) / 100, 0);
        const label = item.projectMember ? `${item.name} - ${item.projectMember}` : item.name;

        parts.push(
            `<line x1="40" y1="${y - 28}" x2="1360" y2="${y - 28}" stroke="#eef2f5"/>`,
            `<text x="70" y="${y}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="18" font-weight="700" fill="#202a35">${svgText(label)}</text>`,
            `<text x="70" y="${y + 24}" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="13" fill="#667789">${formatDate(item.start)} - ${formatDate(item.end)} · ${svgText(item.latestStatus)} · ${formatHours(item.actualHours)} 小時</text>`,
            `<rect x="${left.toFixed(1)}" y="${y - 20}" width="${barWidth.toFixed(1)}" height="28" rx="14" fill="#dbeef5" stroke="#9bc7d7"/>`,
            `<rect x="${left.toFixed(1)}" y="${y - 20}" width="${progressWidth.toFixed(1)}" height="28" rx="14" fill="#2f8f83"/>`,
            `<text x="${(left + barWidth / 2).toFixed(1)}" y="${y - 1}" text-anchor="middle" font-family="Segoe UI, Noto Sans TC, Arial, sans-serif" font-size="13" font-weight="700" fill="#183642">${Math.round(Number(item.progress || 0))}%</text>`
        );
    });

    parts.push('</svg>');
    return parts.join('\n');
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

function sumHoursForWorkItem(workItemId, reportMonth = '') {
    return progressReports
        .filter(report => report.workItemId === workItemId)
        .filter(report => !reportMonth || getReportMonth(report) === reportMonth)
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
