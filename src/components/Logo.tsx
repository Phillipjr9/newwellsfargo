import wordmark from "../assets/wf-logo.png";

export default function Logo() {
  return (
    <a className="masthead-brand" href="/home" aria-label="Wells Fargo homepage, unofficial preview">
      <img src={wordmark} width="220" height="23" alt="Wells Fargo" />
    </a>
  );
}
