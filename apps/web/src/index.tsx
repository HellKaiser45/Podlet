import './index.css';
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router'
import 'solid-devtools';
import App from './App';
import AgentBuilder from './routes/AgentBuilder';
import PlaygroundPage from './routes/playground';
import Sidebar from './components/sidebar';
import Chat from './components/chat/mainChat';



const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?',
  );
}
render(() => (
  <Router root={App} >
    <Route path={"/"} component={AgentBuilder} />
    <Route path={"/playground"}
      component={PlaygroundPage} />
    <Route path={'/chat/:runid'} component={Chat} />
  </Router>

), document.getElementById('root')!)
