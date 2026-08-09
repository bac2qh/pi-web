export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    if (document.execCommand("copy") === false) {
      throw new Error("Clipboard copy was rejected");
    }
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  } finally {
    textarea?.remove();
  }
}
