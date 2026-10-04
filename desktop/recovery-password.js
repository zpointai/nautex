const exporting = new URLSearchParams(location.search).get("mode") === "export";
const password = document.getElementById("password"), repeat = document.getElementById("repeat");
if (!exporting) {
  document.getElementById("heading").textContent = "Open your recovery copy";
  document.getElementById("explanation").textContent = "Enter the recovery password chosen when this copy was created. It is separate from your Nautex login password.";
  document.getElementById("repeat-label").hidden = true;
  password.autocomplete = "current-password";
}
document.getElementById("cancel").onclick = () => window.recovery.submit(null);
document.getElementById("form").onsubmit = event => {
  event.preventDefault();
  if (exporting && password.value !== repeat.value) { document.getElementById("error").textContent = "The passwords do not match."; return; }
  window.recovery.submit(password.value);
  password.value = ""; repeat.value = "";
};
