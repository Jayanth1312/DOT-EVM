/**
 * Reusable Text Input Component for EVM CLI
 * A flexible text input field with customizable borders, placeholders, and behavior
 */

function createTextBox(React, Text, Box, TextInput, props) {
  const {
    width = 50,
    placeholder = "",
    value = "",
    onChange = () => {},
    onSubmit = () => {},
    isPassword = false,
    label = "",
    borderColor = "cyan",
    isActive = true,
  } = props;

  const horiz = "─".repeat(width);

  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(Text, { color: borderColor }, `┌${horiz}┐`),

    React.createElement(
      Box,
      { flexDirection: "row" },
      React.createElement(Text, { color: borderColor }, "│"),
      React.createElement(
        Box,
        { flexDirection: "row", width: width, alignItems: "center" },
        React.createElement(Text, { color: "white" }, " > "),
        label && React.createElement(Text, { color: "gray" }, label),
        isActive
          ? React.createElement(TextInput, {
              value: value,
              onChange: onChange,
              onSubmit: onSubmit,
              placeholder: placeholder,
              mask: isPassword ? "*" : undefined,
            })
          : React.createElement(
              Text,
              { color: "white" },
              isPassword ? ` ${"*".repeat(value.length)}` : ` ${value}`
            )
      ),
      React.createElement(Text, { color: borderColor }, "│")
    ),

    React.createElement(Text, { color: borderColor }, `└${horiz}┘`)
  );
}

/**
 * Create a simple prompt interface for single input
 * Useful for project initialization, asking for names, etc.
 */
async function createSimplePrompt(options = {}) {
  const {
    title = "",
    placeholder = "Enter value",
    width = 50,
    borderColor = "cyan",
    isPassword = false,
    validateInput = () => true,
    errorMessage = "Invalid input. Please try again.",
  } = options;

  return new Promise(async (resolve) => {
    let hasResolved = false;
    const ReactModule = await import("react");
    const React = ReactModule.default || ReactModule;
    const { useState } = React;
    const ink = await import("ink");
    const TextInputModule = await import("ink-text-input");
    const TextInput = TextInputModule.default || TextInputModule;

    const { render, Box, Text } = ink;

    const App = ({ onSubmit }) => {
      const [inputValue, setInputValue] = useState("");
      const [error, setError] = useState("");

      const submit = () => {
        const trimmedValue = inputValue.trim();
        if (!trimmedValue) return;

        if (validateInput(trimmedValue)) {
          if (!hasResolved) {
            hasResolved = true;
            onSubmit(trimmedValue);
          }
        } else {
          setError(errorMessage);
          setTimeout(() => setError(""), 3000); // Clear error after 3 seconds
        }
      };

      return React.createElement(
        Box,
        { flexDirection: "column" },

        // Title
        title &&
          React.createElement(
            Box,
            { marginBottom: 1 },
            React.createElement(Text, { color: "white", bold: true }, title)
          ),

        // Input field
        createTextBox(React, Text, Box, TextInput, {
          width,
          placeholder,
          value: inputValue,
          onChange: setInputValue,
          onSubmit: submit,
          borderColor,
          isPassword,
          isActive: true,
        }),

        // Error message
        error &&
          React.createElement(
            Box,
            { marginTop: 1 },
            React.createElement(Text, { color: "red" }, `⚠ ${error}`)
          ),

        // Help text
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(
            Text,
            { color: "gray" },
            "Press Enter to submit, Ctrl+C to cancel"
          )
        )
      );
    };

    const instance = render(
      React.createElement(App, {
        onSubmit: (value) => {
          try {
            instance.unmount();
          } catch (e) {}

          try {
            if (process && process.stdin && process.stdin.isTTY) {
              try {
                process.stdin.setRawMode(false);
              } catch (e) {}
              try {
                process.stdin.pause();
              } catch (e) {}
            }
          } catch (e) {}

          resolve(value);
        },
      })
    );
  });
}

async function createMultiStepForm(steps = []) {

  const results = {};

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const value = await createSimplePrompt({
      title: step.title || `Step ${i + 1}/${steps.length}`,
      placeholder: step.placeholder || "Enter value",
      width: step.width || 50,
      borderColor: step.borderColor || "cyan",
      isPassword: step.isPassword || false,
      validateInput: step.validate || (() => true),
      errorMessage: step.errorMessage || "Invalid input. Please try again.",
    });

    results[step.key] = value;
  }

  return results;
}

module.exports = {
  createTextBox,
  createSimplePrompt,
  createMultiStepForm,
};
