// The signed-out page: Home in the design's locked state. It loads no data at all; the only
// thing it can do is post the security code (or go to Google) to sign in.
import { Component, html, render } from '/vendor/preact-htm.js';
import { Home } from './home.js';
import { applyTheme, initialTheme } from './theme.js';

applyTheme(initialTheme());
const root = document.getElementById('app');
const d = root.dataset;
const locked = {
  next: d.next || '/',
  message: d.message || '',
  passcode: d.passcode === '1',
  google: d.google === '1',
  googleHref: d.googleHref || '/login/google',
};

class Locked extends Component {
  state = { theme: document.documentElement.dataset.theme, now: Date.now() };
  toggleTheme = () => this.setState({ theme: applyTheme(this.state.theme === 'dark' ? 'light' : 'dark', true) });
  render() {
    return html`<${Home} locked=${locked} data=${null} now=${this.state.now} theme=${this.state.theme} onTheme=${this.toggleTheme} />`;
  }
}

root.textContent = '';
render(html`<${Locked} />`, root);
