export default function ApplicationPage() {
  const dashboardUrl = `${location.protocol}//${location.host}/dashboard`

  return (
    <iframe
      src={dashboardUrl}
      style={{ flex: 1, width: '100%', height: '100%', border: 'none', display: 'block' }}
      title="Node-RED Dashboard"
    />
  )
}
