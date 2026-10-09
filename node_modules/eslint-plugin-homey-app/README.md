# ESLint Plugin for Homey Apps

ESLint rules that enforce best practices for Homey Apps.

## Installation

```bash
npm install --save-dev eslint-plugin-homey-app
```

## Usage

### Flat config (`eslint.config.js`)

```js
const homeyApp = require('eslint-plugin-homey-app');

module.exports = [
  homeyApp.configs['flat/recommended'],
];
```

### Legacy config (`.eslintrc`)

```json
{
  "extends": ["plugin:homey-app/recommended"]
}
```

## Rules

### `homey-app/global-timers`

Warns when using global `setTimeout` or `setInterval` instead of `this.homey.setTimeout` / `this.homey.setInterval`. Global timers are not automatically cleared when the app is destroyed.

### `homey-app/homey-log`

Warns when using `console.log` or `console.error` instead of `this.log` / `this.error`.

