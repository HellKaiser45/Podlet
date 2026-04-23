import { RouteSectionProps } from '@solidjs/router'
import Sidebar from './components/sidebar';
import Topbar from './components/topbar';
import SideDrawer from './components/fileDrawer/sidedrawer';

// App.tsx
export default function App(props: RouteSectionProps) {
  return (
    // Ensure h-dvh is used to handle mobile browser bars correctly
    <div data-theme="catppuccin-mocha" class="flex h-dvh w-full font-mono overflow-hidden">
      <SideDrawer />
      <Sidebar>
        {/* This div is the key container for Topbar + Content */}
        <div class="flex flex-col flex-1 h-full min-h-0 overflow-hidden">
          <Topbar />
          {/* props.children (The Chat component) needs to be a flex child that can't grow */}
          <main class="flex-1 min-h-0 flex flex-col overflow-hidden">
            {props.children}
          </main>
        </div>
      </Sidebar>
    </div>
  )
}
