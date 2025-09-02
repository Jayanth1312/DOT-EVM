const { createTextBox } = require("./components/text-input");

async function promptCredentials() {
  return new Promise(async (resolve) => {
    const ReactModule = await import("react");
    const React = ReactModule.default || ReactModule;
    const ink = await import("ink");
    const TextInputModule = await import("ink-text-input");
    const TextInput = TextInputModule.default || TextInputModule;

    const { render, Box, Text } = ink;
    const { useState } = React;

    const App = ({ onSubmit }) => {
      const [inputValue, setInputValue] = useState("");
      const [currentStep, setCurrentStep] = useState("email");
      const [collectedData, setCollectedData] = useState({});

      const getCurrentPlaceholder = () => {
        switch (currentStep) {
          case "email":
            return "Enter your email";
          case "password":
            return "Enter your password";
          default:
            return "Enter your email";
        }
      };

      const isPasswordStep = () => currentStep === "password";

      const submit = () => {
        const trimmedValue = inputValue.trim();
        if (!trimmedValue) return;

        if (currentStep === "email") {
          setCollectedData({ ...collectedData, email: trimmedValue });
          setCurrentStep("password");
          setInputValue("");
          return;
        }

        if (currentStep === "password") {
          const finalData = {
            email: collectedData.email,
            password: trimmedValue,
          };
          onSubmit(finalData);
          return;
        }
      };

    return React.createElement(
      Box,
      { flexDirection: "column" },

      createTextBox(React, Text, Box, TextInput, {
        width: 50,
        placeholder: getCurrentPlaceholder(),
        value: inputValue,
        onChange: setInputValue,
        onSubmit: submit,
        borderColor: "gray",
        isPassword: isPasswordStep(),
        isActive: true,
      }),

      React.createElement(
        Box,
        { marginTop: 1},
        React.createElement(
        Text,
        { color: "gray", marginTop: 2 },
        currentStep === "email"
          ? "Step 1/2: Email Address, Enter to continue"
          : "Step 2/2: Password, Enter to submit"
        )
      )
    );
    };

    const instance = render(
      React.createElement(App, {
        onSubmit: (data) => {
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
          resolve(data);
        },
      })
    );
  });
}

module.exports = { promptCredentials };
