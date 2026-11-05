let lastActiveTab = null;
const DEFAULTS = {
  autoTrackDomains: ["github.com"],
  globalDefaultMinutes: 10,
  cooldownMinutes: 60,
  enableIdleDetection: true,
  activeTasks: [],
  cooldowns: {},
};

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
function domainMatches(host, pattern) {
  if (!host || !pattern) return false;
  host = host.toLowerCase();
  pattern = pattern.toLowerCase().replace(/^www\./, "");
  return host === pattern || host.endsWith("." + pattern);
}
async function getStore() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...data };
}
async function setStore(o) {
  await chrome.storage.local.set(o);
}
async function updateBadge() {
  const { activeTasks } = await getStore();
  const n = activeTasks.filter((t) => t.status !== "done").length;
  chrome.action.setBadgeText({ text: n ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
}

async function startTracking(tab, minutes, reason = "leave") {
  if (
    !tab ||
    !tab.url ||
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("edge://") ||
    tab.url.startsWith("about:")
  )
    return null;
  const domain = getDomain(tab.url);
  if (!domain) return null;
  const store = await getStore();
  const now = Date.now();
  // cooldown check
  for (const [cdDomain, exp] of Object.entries(store.cooldowns)) {
    if (domainMatches(domain, cdDomain) && now < exp) {
      console.log(`[TaskRecall] cooldown active for ${domain}, skip`);
      return null;
    }
  }
  // avoid duplicate pending for same tab
  if (
    store.activeTasks.some((t) => t.tabId === tab.id && t.status === "pending")
  ) {
    console.log("[TaskRecall] already tracking tab", tab.id);
    return null;
  }
  const id = `${Date.now()}-${tab.id}-${Math.random().toString(36).slice(2, 5)}`;
  const alarmName = `task-${id}`;
  const task = {
    id,
    tabId: tab.id,
    url: tab.url,
    title: tab.title || domain,
    domain,
    favIconUrl: tab.favIconUrl || "",
    leftAt: now,
    remindAfter: minutes || store.globalDefaultMinutes,
    alarmName,
    status: "pending",
    reason,
  };
  store.activeTasks.push(task);
  await setStore({ activeTasks: store.activeTasks });
  await chrome.alarms.create(alarmName, { delayInMinutes: task.remindAfter });
  // for testing allow sub-minute: if <1, use periodInMinutes fallback? Use delayInMinutes still works with float
  await updateBadge();
  console.log(
    `[TaskRecall] START tracking ${domain} (${minutes}m) tab=${tab.id} alarm=${alarmName}`,
  );
  return task;
}

async function clearTask(taskId, reason = "finished") {
  const store = await getStore();
  const task = store.activeTasks.find((t) => t.id === taskId);
  if (!task) {
    await updateBadge();
    return;
  }
  try {
    await chrome.alarms.clear(task.alarmName);
  } catch {}
  if (reason === "finished") {
    const expiry = Date.now() + store.cooldownMinutes * 60 * 1000;
    store.cooldowns[task.domain] = expiry;
    // clear all tasks for same domain (new session rule)
    store.activeTasks = store.activeTasks.filter(
      (t) => !domainMatches(t.domain, task.domain) && t.domain !== task.domain,
    );
  } else {
    store.activeTasks = store.activeTasks.filter((t) => t.id !== taskId);
  }
  // clean expired cooldowns
  const now = Date.now();
  for (const d in store.cooldowns)
    if (store.cooldowns[d] < now) delete store.cooldowns[d];
  await setStore({
    activeTasks: store.activeTasks,
    cooldowns: store.cooldowns,
  });
  await updateBadge();
  console.log(`[TaskRecall] CLEAR ${task.domain} reason=${reason}`);
}

async function handleLeave(prev) {
  if (!prev) return;
  let tab;
  try {
    tab = await chrome.tabs.get(prev.tabId);
  } catch {
    return;
  }
  if (!tab.url || !tab.title) return;
  const store = await getStore();
  const domain = getDomain(tab.url);
  if (!domain) return;
  const isAuto = store.autoTrackDomains.some((d) => domainMatches(domain, d));
  const session = await chrome.storage.session.get(`manual-${tab.id}`);
  const isManual = !!session[`manual-${tab.id}`];
  console.log(
    `[TaskRecall] LEAVE tab=${tab.id} domain=${domain} auto=${isAuto} manual=${isManual}`,
  );
  if (isAuto || isManual) {
    const mins =
      session[`manual-${tab.id}`]?.minutes || store.globalDefaultMinutes;
    await startTracking(tab, mins, isAuto ? "auto" : "manual");
  }
}
async function handleReturn(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const domain = getDomain(tab.url);
    const store = await getStore();
    // if returning to exact tab that was tracked, cancel it (user back)
    let changed = false;
    const remaining = [];
    for (const t of store.activeTasks) {
      if (t.tabId === tabId && t.status === "pending") {
        try {
          await chrome.alarms.clear(t.alarmName);
        } catch {}
        changed = true;
        continue;
      }
      // if new tab for same domain -> clear old (point 4: new tab = new session)
      if (
        domain &&
        t.tabId !== tabId &&
        domainMatches(t.domain, domain) &&
        domainMatches(domain, t.domain)
      ) {
        // only if this tab is newly created (not the tracked one) - treat as new session
        try {
          await chrome.alarms.clear(t.alarmName);
        } catch {}
        changed = true;
        continue;
      }
      remaining.push(t);
    }
    if (changed) {
      store.activeTasks = remaining;
      await setStore({ activeTasks: remaining });
      await updateBadge();
      console.log(`[TaskRecall] RETURN to ${domain} cleared old timers`);
    }
  } catch {}
}

// Events
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const prev = lastActiveTab;
  if (prev && prev.tabId !== activeInfo.tabId) {
    await handleLeave(prev);
  }
  lastActiveTab = { tabId: activeInfo.tabId, windowId: activeInfo.windowId };
  await handleReturn(activeInfo.tabId);
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    lastActiveTab = {
      tabId,
      windowId: tab.windowId,
      url: tab.url,
      domain: getDomain(tab.url),
    };
  }
});
chrome.windows.onFocusChanged.addListener(async (winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) {
    if (lastActiveTab) await handleLeave(lastActiveTab);
  } else {
    const tabs = await chrome.tabs.query({ active: true, windowId: winId });
    if (tabs[0]) {
      await handleReturn(tabs[0].id);
      lastActiveTab = { tabId: tabs[0].id, windowId: winId };
    }
  }
});
chrome.idle.onStateChanged.addListener(async (state) => {
  const { enableIdleDetection } = await getStore();
  if (!enableIdleDetection) return;
  if (state === "idle" || state === "locked") {
    if (lastActiveTab) await handleLeave(lastActiveTab);
  }
});

// Alarm -> show both notification AND popup window
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("task-")) return;
  const store = await getStore();
  const task = store.activeTasks.find((t) => t.alarmName === alarm.name);
  if (!task) return;
  console.log(`[TaskRecall] ALARM fired for ${task.domain}`, task);
  task.status = "notified";
  await setStore({ activeTasks: store.activeTasks });
  await updateBadge();

  // 1. Notification (may be blocked, so we also do popup)
  try {
    await chrome.notifications.create(`recall-${task.id}`, {
      type: "basic",
      iconUrl: "icon128.png",
      title: `Still working on ${task.domain}?`,
      message: `${task.title.slice(0, 80)}\nLeft ${task.remindAfter} min ago. Return?`,
      buttons: [{ title: "↩ Return to Task" }, { title: "✓ Finished" }],
      priority: 2,
      requireInteraction: true,
    });
  } catch (e) {
    console.warn("notif failed", e);
  }

  // 2. Popup window fallback - ALWAYS shows
  try {
    const popupUrl = chrome.runtime.getURL(
      `reminder.html?taskId=${encodeURIComponent(task.id)}`,
    );
    await chrome.windows.create({
      url: popupUrl,
      type: "popup",
      width: 400,
      height: 340,
      focused: true,
    });
  } catch (e) {
    console.warn("popup window failed", e);
  }
});

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
  if (!notifId.startsWith("recall-")) return;
  const taskId = notifId.replace("recall-", "");
  const store = await getStore();
  const task = store.activeTasks.find((t) => t.id === taskId);
  if (!task) {
    chrome.notifications.clear(notifId);
    return;
  }
  if (btnIdx === 0) {
    // Return
    try {
      const tabs = await chrome.tabs.query({});
      const ex = tabs.find((t) => t.id === task.tabId);
      if (ex) {
        await chrome.tabs.update(task.tabId, { active: true });
        await chrome.windows.update(ex.windowId, { focused: true });
      } else await chrome.tabs.create({ url: task.url, active: true });
    } catch {
      await chrome.tabs.create({ url: task.url, active: true });
    }
    await clearTask(taskId, "returned");
  } else {
    await clearTask(taskId, "finished");
  }
  chrome.notifications.clear(notifId);
});
chrome.notifications.onClicked.addListener(async (notifId) => {
  if (!notifId.startsWith("recall-")) return;
  const taskId = notifId.replace("recall-", "");
  const store = await getStore();
  const task = store.activeTasks.find((t) => t.id === taskId);
  if (task) {
    try {
      await chrome.tabs.create({ url: task.url, active: true });
    } catch {}
    await clearTask(taskId, "returned");
  }
  chrome.notifications.clear(notifId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "TRACK_CURRENT") {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab) {
        await chrome.storage.session.set({
          [`manual-${tab.id}`]: {
            minutes: msg.minutes || 10,
            trackedAt: Date.now(),
          },
        });
        lastActiveTab = { tabId: tab.id, windowId: tab.windowId };
        console.log("[TaskRecall] Manual track set", tab.id, msg.minutes);
        sendResponse({ ok: true });
      }
    } else if (msg.type === "UNTRACK_CURRENT") {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab) {
        await chrome.storage.session.remove(`manual-${tab.id}`);
        const store = await getStore();
        const toClear = store.activeTasks.filter((t) => t.tabId === tab.id);
        for (const t of toClear)
          try {
            await chrome.alarms.clear(t.alarmName);
          } catch {}
        store.activeTasks = store.activeTasks.filter((t) => t.tabId !== tab.id);
        await setStore({ activeTasks: store.activeTasks });
        await updateBadge();
        sendResponse({ ok: true });
      }
    } else if (msg.type === "RETURN_TASK" || msg.type === "FINISH_TASK") {
      const taskId = msg.taskId;
      const store = await getStore();
      const task = store.activeTasks.find((t) => t.id === taskId);
      if (task && msg.type === "RETURN_TASK") {
        try {
          const tabs = await chrome.tabs.query({});
          const ex = tabs.find((t) => t.id === task.tabId);
          if (ex) {
            await chrome.tabs.update(task.tabId, { active: true });
            await chrome.windows.update(ex.windowId, { focused: true });
          } else await chrome.tabs.create({ url: task.url, active: true });
        } catch {
          await chrome.tabs.create({ url: task.url, active: true });
        }
      }
      await clearTask(
        taskId,
        msg.type === "RETURN_TASK" ? "returned" : "finished",
      );
      sendResponse({ ok: true });
    } else if (msg.type === "GET_STATE") {
      const store = await getStore();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const session = tab
        ? await chrome.storage.session.get(`manual-${tab.id}`)
        : {};
      sendResponse({
        ...store,
        currentTab: tab,
        isCurrentTracked: !!(tab && session[`manual-${tab.id}`]),
      });
    } else if (msg.type === "GET_TASK") {
      const store = await getStore();
      const task = store.activeTasks.find((t) => t.id === msg.taskId);
      sendResponse({ task });
    }
  })();
  return true;
});

(async () => {
  const store = await getStore();
  const now = Date.now();
  for (const d in store.cooldowns)
    if (store.cooldowns[d] < now) delete store.cooldowns[d];
  await setStore({ cooldowns: store.cooldowns });
  await updateBadge();
  console.log("[TaskRecall] Initialized", store);
})();
