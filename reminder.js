function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}
async function init() {
  const taskId = getParam("taskId");
  if (!taskId) return;
  const { task } = await chrome.runtime.sendMessage({
    type: "GET_TASK",
    taskId,
  });
  if (!task) {
    document.getElementById("title").textContent = "Task not found";
    document.getElementById("domain").textContent = "It may have been cleared";
    return;
  }
  document.getElementById("title").textContent = task.title.slice(0, 60);
  document.getElementById("domain").textContent = task.domain;
  document.getElementById("url").textContent = task.url;
  const elapsed = Math.floor((Date.now() - task.leftAt) / 60000);
  document.getElementById("meta").textContent =
    `You left ${elapsed} min ago • reminder after ${task.remindAfter} min`;

  document.getElementById("returnBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "RETURN_TASK", taskId });
    window.close();
  });
  document.getElementById("finishBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "FINISH_TASK", taskId });
    window.close();
  });
}
init();
