export const metadata = {
  title: 'SelfAI Demo',
  description: 'Demo entry page'
};

export default function DemoPage() {
  const rows = [
    { task: 'Image Completion', model: 'GPT4-o3-mini', status: 'Ready', budget: '64 trials' },
    { task: 'Node Classification', model: 'Qwen2.5-14b', status: 'Queued', budget: '25 trials' },
    { task: 'Bioactivity Prediction', model: 'DeepSeek-r1-32b', status: 'Running', budget: '30 trials' },
    { task: 'BraTS Segmentation', model: 'Llama3.3-70b', status: 'Paused', budget: '18 trials' }
  ];

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #edf2fb 0%, #e5ebf7 100%)',
        color: '#1b2638',
        padding: 24,
        position: 'relative'
      }}
    >
      <a
        href="/#abstract"
        style={{
          position: 'fixed',
          top: 18,
          left: 18,
          display: 'inline-block',
          padding: '9px 16px',
          borderRadius: 999,
          background: '#1b2638',
          color: '#f3f6fb',
          textDecoration: 'none',
          fontSize: '0.9rem',
          fontWeight: 600,
          zIndex: 10
        }}
      >
        返回文章
      </a>

      <section style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div
          style={{
            width: 'min(980px, 100%)',
            background: '#f8fbff',
            border: '1px solid #c8d4e8',
            borderRadius: 14,
            boxShadow: '0 10px 28px rgba(33, 52, 84, 0.08)',
            overflow: 'hidden'
          }}
        >
          <div style={{ padding: '18px 20px', borderBottom: '1px solid #c8d4e8', background: '#e9f0fb' }}>
            <h1 style={{ margin: 0, fontSize: '1.4rem' }}>SelfAI Demo Table</h1>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Task</th>
                  <th style={thStyle}>Backbone Model</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Budget</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.task}-${row.model}`}>
                    <td style={tdStyle}>{row.task}</td>
                    <td style={tdStyle}>{row.model}</td>
                    <td style={tdStyle}>{row.status}</td>
                    <td style={tdStyle}>{row.budget}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}

const thStyle = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: '0.82rem',
  fontWeight: 700,
  color: '#1d2d45',
  borderBottom: '1px solid #cfdbeb',
  whiteSpace: 'nowrap',
  background: '#f1f6ff'
};

const tdStyle = {
  padding: '12px 14px',
  fontSize: '0.92rem',
  color: '#273a56',
  borderBottom: '1px solid #dde6f3'
};
