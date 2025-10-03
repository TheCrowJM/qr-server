// public/dark-mode.js
(function () {
  const KEY = "qr_theme";
  function apply(t){ if(t==="dark"){document.documentElement.classList.add("dark");document.body.classList.add("dark")} else {document.documentElement.classList.remove("dark");document.body.classList.remove("dark")} }
  const stored = (()=>{try{return localStorage.getItem(KEY)}catch{return null}})();
  apply(stored||"light");
  window.toggleTheme = function(){
    const cur = (document.body.classList.contains("dark")?"dark":"light");
    const next = cur==="dark"?"light":"dark";
    apply(next);
    try{localStorage.setItem(KEY,next);}catch{}
    document.querySelectorAll("[data-theme-toggle]").forEach(b=>b.textContent = next==="dark" ? "Light" : "Dark");
  };
  document.addEventListener("DOMContentLoaded", ()=>{ const cur = (document.body.classList.contains("dark")?"dark":"light"); document.querySelectorAll("[data-theme-toggle]").forEach(b=>b.textContent = cur==="dark"? "Light":"Dark"); });
})();

