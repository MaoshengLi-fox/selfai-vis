export const metadata = {
  title: 'SelfAI Demo',
  description: 'Demo entry page'
};

export default function DemoPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#e9ecf2', color: '#1b2638', padding: 24 }}>
      <section style={{ textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(2rem, 6vw, 4rem)' }}>SelfAI Demo</h1>
        <p style={{ marginTop: 12, fontSize: '1.1rem', color: '#5f6f83' }}>Demo page is ready. You can implement interactive experiments here.</p>
      </section>
    </main>
  );
}
