import "@testing-library/jest-dom/vitest";

// jsdom reports hasFocus() false until an element is focused; a real foreground page reports true (#328).
if (typeof document !== "undefined") document.hasFocus = () => true;
