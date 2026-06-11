const STORAGE_KEY = "food_records_pwa_v1";
const API_BASE = "/api/records";
const AUTH_BASE = "/api";
const routes = ["dashboard", "record", "list"];
const mealOptions = ["早餐", "早加", "中餐", "中加", "晚餐", "晚加"];
const foodFields = [
  { key: "grain", label: "谷类", placeholder: "米饭 100g / 杂粮面包 25g" },
  { key: "milk", label: "奶类", placeholder: "牛奶 250ml / 酸奶 130g" },
  { key: "protein", label: "肉蛋", placeholder: "鸡蛋 1 个 / 鸡胸肉 100g" },
  { key: "beans", label: "豆类", placeholder: "豆腐 30g / 豆浆 150g" },
  { key: "vegetables", label: "蔬菜", placeholder: "青菜 200g / 西红柿 100g" },
  { key: "fruit", label: "水果", placeholder: "苹果 150g / 蓝莓" },
  { key: "fat", label: "油脂", placeholder: "烹调用油 9g / 坚果" }
];

const emptyFoods = foodFields.reduce((result, field) => {
  result[field.key] = "";
  return result;
}, {});

let currentRoute = "dashboard";
let authenticated = false;
let loginError = "";

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function readRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (error) {
    return [];
  }
}

function writeRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

async function checkSession() {
  try {
    const response = await fetch(`${AUTH_BASE}/session`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return false;
    const data = await response.json();
    return !!data.authenticated;
  } catch (error) {
    return false;
  }
}

async function login(password) {
  const response = await fetch(`${AUTH_BASE}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ password })
  });
  return response.ok;
}

async function logout() {
  await fetch(`${AUTH_BASE}/logout`, {
    method: "POST"
  });
  authenticated = false;
  loginError = "";
  render();
}

async function loadRecords() {
  try {
    const response = await fetch(API_BASE, {
      headers: { Accept: "application/json" }
    });
    if (response.status === 401) {
      authenticated = false;
      return [];
    }
    if (!response.ok) throw new Error("Failed to load records");
    const data = await response.json();
    const records = Array.isArray(data.records) ? data.records.map(normalizeRecord) : [];
    writeRecords(records);
    return records;
  } catch (error) {
    return readRecords().map(normalizeRecord);
  }
}

async function createRecord(record) {
  const normalizedRecord = normalizeRecord(record);
  try {
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(normalizedRecord)
    });
    if (response.status === 401) {
      authenticated = false;
      return { record: normalizedRecord, backend: false, unauthorized: true };
    }
    if (!response.ok) throw new Error("Failed to save record");
    const data = await response.json();
    const savedRecord = normalizeRecord(data.record || normalizedRecord);
    writeRecords([savedRecord, ...readRecords().filter((item) => item.id !== savedRecord.id)]);
    return { record: savedRecord, backend: true };
  } catch (error) {
    writeRecords([normalizedRecord, ...readRecords().filter((item) => item.id !== normalizedRecord.id)]);
    return { record: normalizedRecord, backend: false };
  }
}

async function deleteRecord(id) {
  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    if (response.status === 401) {
      authenticated = false;
      return;
    }
    if (!response.ok) throw new Error("Failed to delete record");
  } catch (error) {
    // Local deletion still keeps the interface usable when the backend is offline.
  }
  writeRecords(readRecords().filter((record) => record.id !== id));
}

async function clearRecords() {
  try {
    const response = await fetch(API_BASE, {
      method: "DELETE"
    });
    if (response.status === 401) {
      authenticated = false;
      return;
    }
    if (!response.ok) throw new Error("Failed to clear records");
  } catch (error) {
    // Local clearing still keeps the interface usable when the backend is offline.
  }
  writeRecords([]);
}

function normalizeRecord(record) {
  return {
    ...record,
    id: record.id || `${Date.now()}`,
    foods: {
      ...emptyFoods,
      ...(record.foods || {})
    }
  };
}

function glucoseLevel(value) {
  const numberValue = Number(value);
  if (!value || Number.isNaN(numberValue)) return "unknown";
  if (numberValue < 3.9) return "low";
  if (numberValue > 10) return "high";
  return "normal";
}

function statusText(level) {
  if (level === "high") return "偏高";
  if (level === "low") return "偏低";
  if (level === "normal") return "平稳";
  return "待记录";
}

function renderLogin() {
  document.body.classList.add("locked");
  return `
    <section class="login-page">
      <div class="login-card">
        <div class="login-mark">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div>
          <h1 class="login-title">膳食与血糖记录</h1>
          <p class="login-subtitle">输入访问密码后继续使用。</p>
        </div>
        <form id="login-form" class="login-form">
          <label class="field">
            <span class="label">访问密码</span>
            <input class="input login-input" name="password" type="password" inputmode="numeric" autocomplete="current-password" placeholder="请输入密码" autofocus />
          </label>
          ${loginError ? `<div class="login-error">${loginError}</div>` : ""}
          <button class="primary-button" type="submit">进入记录</button>
        </form>
      </div>
    </section>
  `;
}

function measured(records) {
  return records.filter((record) => record.glucose && !Number.isNaN(Number(record.glucose)));
}

function averageGlucose(records) {
  const items = measured(records);
  if (!items.length) return "--";
  const total = items.reduce((sum, record) => sum + Number(record.glucose), 0);
  return (total / items.length).toFixed(1);
}

function uniqueDates(records) {
  const dates = [];
  records.forEach((record) => {
    if (!dates.includes(record.date)) dates.push(record.date);
  });
  return dates;
}

function buildAllStats(records) {
  const sortedRecords = records.map(normalizeRecord).sort((a, b) => Number(b.id) - Number(a.id));
  const measuredRecords = measured(sortedRecords);
  const dateMap = {};
  const mealMap = {};
  let lowCount = 0;
  let highCount = 0;
  let exerciseCount = 0;

  sortedRecords.forEach((record) => {
    dateMap[record.date] = true;
    mealMap[record.meal] = (mealMap[record.meal] || 0) + 1;
    if (record.exercise) exerciseCount += 1;
    const level = glucoseLevel(record.glucose);
    if (level === "low") lowCount += 1;
    if (level === "high") highCount += 1;
  });

  const currentDate = today();
  const todayRecords = sortedRecords.filter((record) => record.date === currentDate);
  const todayMeals = {};
  todayRecords.forEach((record) => {
    todayMeals[record.meal] = true;
  });

  const latestMeasured = measuredRecords[0];
  const latestLevel = latestMeasured ? glucoseLevel(latestMeasured.glucose) : "unknown";

  return {
    totalRecords: sortedRecords.length,
    totalDays: Object.keys(dateMap).length,
    measuredCount: measuredRecords.length,
    avgGlucose: averageGlucose(sortedRecords),
    lowCount,
    highCount,
    exerciseCount,
    latestGlucose: latestMeasured ? latestMeasured.glucose : "--",
    latestMeasureTime: latestMeasured
      ? `${latestMeasured.date} ${latestMeasured.measureTime || "未填时间"}`
      : "暂无血糖记录",
    latestLevel,
    latestStatus: statusText(latestLevel),
    today: {
      count: todayRecords.length,
      avgGlucose: averageGlucose(todayRecords),
      exerciseCount: todayRecords.filter((record) => record.exercise).length,
      mealCount: Object.keys(todayMeals).length,
      abnormalCount: measured(todayRecords).filter((record) => {
        const level = glucoseLevel(record.glucose);
        return level === "low" || level === "high";
      }).length,
      meals: mealOptions.map((meal) => ({
        name: meal,
        active: !!todayMeals[meal]
      }))
    },
    mealStats: mealOptions.map((meal) => ({
      name: meal,
      count: mealMap[meal] || 0
    })),
    recentGlucose: measuredRecords.slice(0, 8).map((record) => ({
      id: record.id,
      date: record.date.slice(5),
      meal: record.meal,
      value: record.glucose,
      level: glucoseLevel(record.glucose)
    }))
  };
}

function escapeHtml(value) {
  return `${value || ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
}

function renderDashboard(records) {
  const stats = buildAllStats(records);

  return `
    <section class="header">
      <div>
        <h1 class="title">健康仪表盘</h1>
        <span class="subtitle">所有膳食、血糖和运动记录统计</span>
      </div>
      <div class="header-actions">
        <span class="status-pill ${stats.latestLevel}">${stats.latestStatus}</span>
        <button class="text-button muted" type="button" data-action="logout">退出</button>
      </div>
    </section>

    <section class="card dashboard-grid">
      <div class="glucose-panel">
        <span class="summary-label">最近血糖</span>
        <div class="summary-value ${stats.latestLevel}">
          <span>${stats.latestGlucose}</span>
          <span class="summary-unit">mmol/L</span>
        </div>
        <span class="summary-note">${stats.latestMeasureTime}</span>
      </div>
      <div class="metric-grid">
        ${metric(stats.totalRecords, "总记录")}
        ${metric(stats.totalDays, "记录天数")}
        ${metric(stats.avgGlucose, "平均血糖")}
        ${metric(stats.measuredCount, "测量次数")}
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">今日概览</h2>
      <div class="metric-grid">
        ${metric(stats.today.count, "今日记录")}
        ${metric(stats.today.avgGlucose, "今日均值")}
        ${metric(stats.today.abnormalCount, "今日异常")}
        ${metric(stats.today.exerciseCount, "运动记录")}
      </div>
      <div class="meal-dots" style="margin-top: 14px;">
        ${stats.today.meals.map((meal) => `<span class="meal-dot ${meal.active ? "active" : ""}">${meal.name}</span>`).join("")}
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">异常统计</h2>
      <div class="metric-grid">
        ${metric(stats.lowCount, "偏低次数", "metric-alert low")}
        ${metric(stats.highCount, "偏高次数", "metric-alert high")}
        ${metric(stats.exerciseCount, "总运动记录")}
        ${metric(stats.today.mealCount, "今日已记餐次")}
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">餐次分布</h2>
      ${stats.mealStats.map((item) => {
        const width = stats.totalRecords ? (item.count * 100) / stats.totalRecords : 0;
        return `
          <div class="bar-row">
            <span>${item.name}</span>
            <span class="bar-track"><span class="bar-fill" style="width: ${width}%;"></span></span>
            <span>${item.count}</span>
          </div>
        `;
      }).join("")}
    </section>

    ${stats.recentGlucose.length ? `
      <section class="card">
        <h2 class="card-title">最近血糖</h2>
        <div class="recent-row">
          ${stats.recentGlucose.map((item) => `
            <span class="recent-chip ${item.level}">
              <span class="recent-value">${item.value}</span>
              <span class="recent-meta">${item.date} ${item.meal}</span>
            </span>
          `).join("")}
        </div>
      </section>
    ` : ""}
  `;
}

function metric(value, label, extraClass = "") {
  return `
    <div class="summary-stat ${extraClass}">
      <span class="stat-number">${value}</span>
      <span class="stat-label">${label}</span>
    </div>
  `;
}

function renderRecord() {
  return `
    <section class="header">
      <div>
        <h1 class="title">记录当天日志</h1>
        <div class="subtitle-row">
          <span class="subtitle">${today()} 的膳食、血糖和运动</span>
          <button class="text-button" type="button" data-action="reset-form">重置</button>
        </div>
      </div>
    </section>

    <form id="record-form">
      <section class="card date-grid">
        <label class="field">
          <span class="label">日期</span>
          <span class="readonly">${today()}</span>
        </label>
        <label class="field">
          <span class="label">餐次</span>
          <select class="select" name="meal">
            ${mealOptions.map((meal) => `<option value="${meal}">${meal}</option>`).join("")}
          </select>
        </label>
        <label class="field full">
          <span class="label">就餐时间</span>
          <input class="input" name="mealTime" type="time" />
        </label>
      </section>

      <section class="card">
        <h2 class="card-title">所吃食物</h2>
        <div class="food-grid">
          ${foodFields.map((field) => `
            <label class="field">
              <span class="label">${field.label}</span>
              <textarea class="textarea" name="${field.key}" maxlength="120" placeholder="${field.placeholder}"></textarea>
            </label>
          `).join("")}
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">血糖测量</h2>
        <div class="measure-grid">
          <label class="field">
            <span class="label">测量时间</span>
            <input class="input" name="measureTime" type="time" />
          </label>
          <label class="field">
            <span class="label">血糖值 mmol/L</span>
            <input class="input" name="glucose" type="number" inputmode="decimal" step="0.1" placeholder="如 6.1" />
          </label>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">运动时间</h2>
        <input class="input" name="exercise" placeholder="如 饭后散步 30 分钟" />
      </section>

      <div class="sticky-actions">
        <button class="primary-button" type="submit">保存记录</button>
      </div>
    </form>
  `;
}

function renderList(records) {
  records = records.map(normalizeRecord).sort((a, b) => Number(b.id) - Number(a.id));
  const dates = uniqueDates(records);

  return `
    <section class="header">
      <div>
        <h1 class="title">记录列表</h1>
        <span class="subtitle">全部记录（${records.length}）</span>
      </div>
      ${records.length ? `<button class="secondary-button" type="button" data-action="clear-all">清空</button>` : ""}
    </section>

    ${records.length ? renderExportPanel(dates, records) : ""}

    ${records.length ? records.map(renderRecordCard).join("") : `
      <section class="empty">暂无记录，请到“记录”页填写当天日志。</section>
    `}
  `;
}

function renderExportPanel(dates, records) {
  return `
    <section class="card">
      <div class="header" style="margin-bottom: 12px;">
        <div>
          <h2 class="card-title" style="margin-bottom: 4px;">导出记录</h2>
          <span class="summary-note">选择日期后导出为 Excel 表格</span>
        </div>
        <button class="secondary-button" type="button" data-action="export">导出</button>
      </div>
      <div class="export-actions">
        <button class="text-button" type="button" data-action="select-all-dates">全选</button>
        <button class="text-button" type="button" data-action="clear-dates">清除</button>
        <span class="selected-count" id="selected-count">已选 ${dates.length} 天</span>
      </div>
      <div class="date-checks">
        ${dates.map((date) => `
          <label class="date-check">
            <input type="checkbox" name="exportDate" value="${date}" checked />
            <span>
              <span class="date-check-title">${date}</span>
              <span class="date-check-count">${records.filter((record) => record.date === date).length} 条</span>
            </span>
          </label>
        `).join("")}
      </div>
    </section>
  `;
}

function renderRecordCard(record) {
  const foods = foodFields
    .filter((field) => record.foods[field.key])
    .map((field) => `<span class="tag"><strong>${field.label}</strong>${escapeHtml(record.foods[field.key])}</span>`)
    .join("");
  const level = glucoseLevel(record.glucose);

  return `
    <article class="record-card">
      <div class="record-top">
        <div>
          <span class="record-title">${record.date} ${record.meal}</span>
          <span class="record-time">${record.mealTime || "未填就餐时间"}</span>
        </div>
        <span class="glucose-badge ${level}">
          <span>${record.glucose || "--"}</span>
          <span class="unit">mmol/L</span>
        </span>
      </div>
      <div class="tags">${foods || `<span class="tag">未填写食物</span>`}</div>
      <div class="record-meta">
        <div>测量：${record.measureTime || "未填"}</div>
        <div>运动：${escapeHtml(record.exercise || "未填")}</div>
      </div>
      <div class="record-actions">
        <button class="danger-button" type="button" data-action="delete" data-id="${record.id}">删除</button>
      </div>
    </article>
  `;
}

async function saveRecord(form) {
  const formData = new FormData(form);
  const foods = {};
  foodFields.forEach((field) => {
    foods[field.key] = `${formData.get(field.key) || ""}`.trim();
  });

  const record = normalizeRecord({
    id: `${Date.now()}`,
    date: today(),
    meal: formData.get("meal"),
    mealTime: formData.get("mealTime"),
    foods,
    measureTime: formData.get("measureTime"),
    glucose: formData.get("glucose"),
    exercise: `${formData.get("exercise") || ""}`.trim()
  });

  const hasFood = foodFields.some((field) => record.foods[field.key]);
  if (!hasFood && !record.glucose && !record.exercise) {
    alert("请先填写内容");
    return;
  }

  const result = await createRecord(record);
  if (result.unauthorized) {
    alert("登录已过期，请重新登录。");
    await render();
    return;
  }
  form.reset();
  alert(result.backend ? "已保存到后端" : "后端不可用，已暂存本地");
}

function buildExcelHtml(records, selectedDates) {
  const selectedMap = {};
  selectedDates.forEach((date) => {
    selectedMap[date] = true;
  });
  const rows = records.filter((record) => selectedMap[record.date]);
  const foodHeaders = foodFields.map((field) => `<th>${field.label}</th>`).join("");
  const body = rows.map((record) => {
    const foods = foodFields.map((field) => `<td>${escapeHtml(record.foods[field.key])}</td>`).join("");
    return `
      <tr>
        <td>${escapeHtml(record.date)}</td>
        <td>${escapeHtml(record.meal)}</td>
        <td>${escapeHtml(record.mealTime)}</td>
        ${foods}
        <td>${escapeHtml(record.measureTime)}</td>
        <td>${escapeHtml(record.glucose)}</td>
        <td>${escapeHtml(record.exercise)}</td>
      </tr>
    `;
  }).join("");

  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, "Microsoft YaHei", sans-serif; }
          table { border-collapse: collapse; width: 100%; table-layout: fixed; }
          caption { font-size: 20px; font-weight: 700; padding: 12px; }
          th, td { border: 1px solid #333; padding: 8px; font-size: 12px; vertical-align: top; mso-number-format:"\\@"; }
          th { background: #eef5f1; font-weight: 700; text-align: center; }
          .group { background: #dcebe4; }
        </style>
      </head>
      <body>
        <table>
          <caption>膳食日志及血糖测量表</caption>
          <tr>
            <th rowspan="2">日期</th>
            <th colspan="2" class="group">餐次/就餐时间</th>
            <th colspan="7" class="group">所吃食物</th>
            <th rowspan="2">测量时间</th>
            <th rowspan="2">血糖值</th>
            <th rowspan="2">运动时间</th>
          </tr>
          <tr>
            <th>餐次</th>
            <th>就餐时间</th>
            ${foodHeaders}
          </tr>
          ${body}
        </table>
      </body>
    </html>
  `;
}

function exportSelectedDates() {
  const selectedDates = [...document.querySelectorAll("input[name='exportDate']:checked")].map((input) => input.value);
  if (!selectedDates.length) {
    alert("请选择日期");
    return;
  }

  const records = readRecords().map(normalizeRecord);
  const html = buildExcelHtml(records, selectedDates);
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `膳食血糖记录-${Date.now()}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function updateSelectedCount() {
  const count = document.querySelectorAll("input[name='exportDate']:checked").length;
  const label = document.getElementById("selected-count");
  if (label) label.textContent = `已选 ${count} 天`;
}

function setRoute(route) {
  currentRoute = routes.includes(route) ? route : "dashboard";
  location.hash = currentRoute;
  render();
}

async function render() {
  const app = document.getElementById("app");
  if (!authenticated) authenticated = await checkSession();
  if (!authenticated) {
    app.innerHTML = renderLogin();
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    return;
  }

  document.body.classList.remove("locked");
  const route = routes.includes(location.hash.replace("#", ""))
    ? location.hash.replace("#", "")
    : currentRoute;
  currentRoute = route;
  const records = route === "record" ? [] : await loadRecords();

  if (route === "record") app.innerHTML = renderRecord();
  if (route === "list") app.innerHTML = renderList(records);
  if (route === "dashboard") app.innerHTML = renderDashboard(records);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.route === currentRoute);
  });
}

document.addEventListener("click", async (event) => {
  const tab = event.target.closest(".tab");
  if (tab) {
    setRoute(tab.dataset.route);
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;

  if (action.dataset.action === "reset-form") {
    document.getElementById("record-form")?.reset();
  }
  if (action.dataset.action === "logout") {
    await logout();
  }
  if (action.dataset.action === "delete") {
    await deleteRecord(action.dataset.id);
    await render();
  }
  if (action.dataset.action === "clear-all" && confirm("删除全部记录？")) {
    await clearRecords();
    await render();
  }
  if (action.dataset.action === "select-all-dates") {
    document.querySelectorAll("input[name='exportDate']").forEach((input) => {
      input.checked = true;
    });
    updateSelectedCount();
  }
  if (action.dataset.action === "clear-dates") {
    document.querySelectorAll("input[name='exportDate']").forEach((input) => {
      input.checked = false;
    });
    updateSelectedCount();
  }
  if (action.dataset.action === "export") {
    exportSelectedDates();
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "login-form") {
    event.preventDefault();
    const password = new FormData(event.target).get("password");
    const ok = await login(password);
    if (!ok) {
      loginError = "密码不正确，请重新输入。";
      authenticated = false;
      await render();
      return;
    }
    loginError = "";
    authenticated = true;
    await render();
  }

  if (event.target.id === "record-form") {
    event.preventDefault();
    await saveRecord(event.target);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.name === "exportDate") updateSelectedCount();
});

window.addEventListener("hashchange", render);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}

setRoute(location.hash.replace("#", "") || "dashboard");
