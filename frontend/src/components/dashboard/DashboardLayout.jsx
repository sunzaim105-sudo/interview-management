import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import './DashboardLayout.css';

function DashboardLayout() {
  return (
    <div className="dashboard-shell">
      <Sidebar />
      <div className="dashboard-shell__main">
        <Outlet />
      </div>
    </div>
  );
}

export default DashboardLayout;
