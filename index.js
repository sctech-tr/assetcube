document.getElementById("uploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);

    const res = await fetch("/.netlify/functions/upload", {
        method: "POST",
        body: formData
    });

    const text = await res.text();
    document.getElementById("result").textContent = text;
});