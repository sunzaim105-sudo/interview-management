import UserMenu from '../../components/dashboard/UserMenu';
import './PlaceholderPage.css';

function PlaceholderPage({ title, description }) {
  return (
    <div className="placeholder-page">
      <header className="placeholder-page__header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <UserMenu />
      </header>
      <div className="placeholder-page__panel">
        <strong>Coming soon</strong>
        <p>Features for this section are not defined yet.</p>
      </div>
    </div>
  );
}

export default PlaceholderPage;
