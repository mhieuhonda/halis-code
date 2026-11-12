/** Boot splash — brand mark on the deep chrome, quiet dots. */
import logoUrl from '../../assets/logo.png'
import nameUrl from '../../assets/name.png'

export function Splash() {
  return (
    <div className="splash">
      <img src={logoUrl} alt="Halis Code" className="logo" draggable={false} />
      <img src={nameUrl} alt="" className="name" draggable={false} />
      <div style={{ display: 'flex', gap: 3, marginTop: 14 }}>
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  )
}
