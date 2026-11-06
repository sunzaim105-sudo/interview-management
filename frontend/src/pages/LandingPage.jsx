import Hero from '../components/landing/Hero';
import Features from '../components/landing/Features';
import Comparison from '../components/landing/Comparison';
import './LandingPage.css';

function LandingPage() {
  return (
    <main className="landing">
      <Hero />
      <Features />
      <Comparison />
    </main>
  );
}

export default LandingPage;
