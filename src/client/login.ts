/**
 * Login page logic: submit credentials, handle "keep me signed in", and
 * redirect to the main app on success.
 */

const form = document.getElementById("login-form") as HTMLFormElement;
const errorEl = document.getElementById("login-error") as HTMLParagraphElement;

// If already authenticated, go straight to the app.
async function checkAuth(): Promise<void> {
  try {
    const res = await fetch("/api/auth/check");
    if (res.ok) {
      window.location.replace("/");
    }
  } catch {
    // Not authenticated; stay on the login page.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;

  const username = (document.getElementById("username") as HTMLInputElement).value;
  const password = (document.getElementById("password") as HTMLInputElement).value;
  const remember = (document.getElementById("remember") as HTMLInputElement).checked;

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, remember }),
    });

    if (res.ok) {
      window.location.replace("/");
    } else {
      errorEl.textContent = "Invalid username or password.";
      errorEl.hidden = false;
    }
  } catch {
    errorEl.textContent = "Connection error. Please try again.";
    errorEl.hidden = false;
  }
});

void checkAuth();
