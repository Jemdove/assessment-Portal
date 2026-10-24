// =====================================================
// EYE BUTTON: show or hide a password
// The look of the eye is in styles.css (.eye and .eye.showing)
// =====================================================
document.querySelectorAll(".eye").forEach(function (button) {
  button.addEventListener("click", function () {
    const input = button.previousElementSibling;
    const show = input.type === "password";

    input.type = show ? "text" : "password";
    button.classList.toggle("showing", show);
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    input.focus();
  });
});
