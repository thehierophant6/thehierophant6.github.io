const repoOwner = "thehierophant6";
const repoName = "thehierophant6.github.io";
const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/`;

async function fetchScripts() {
    try {
        let response = await fetch(apiUrl);
        let files = await response.json();
        
        // Filter for .js files only
        let scripts = files
            .filter(file => file.name.endsWith(".js"))
            .map(file => file.name);

        // Load UI and scripts
        createUI(scripts);
        loadSelectedScripts(scripts);
    } catch (error) {
        console.error("Error fetching scripts:", error);
    }
}

function createUI(scripts) {
    let selectedScripts = JSON.parse(localStorage.getItem("selectedScripts")) || [];

    let menu = document.createElement("div");
    menu.style.position = "fixed";
    menu.style.top = "10px";
    menu.style.right = "10px";
    menu.style.background = "white";
    menu.style.padding = "10px";
    menu.style.border = "1px solid black";
    menu.style.zIndex = "9999";
    menu.style.maxHeight = "300px";
    menu.style.overflowY = "scroll";

    let title = document.createElement("h4");
    title.innerText = "Select Scripts:";
    menu.appendChild(title);

    scripts.forEach(scriptName => {
        let checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedScripts.includes(scriptName);
        checkbox.onchange = function () {
            if (this.checked) {
                selectedScripts.push(scriptName);
            } else {
                selectedScripts = selectedScripts.filter(s => s !== scriptName);
            }
            localStorage.setItem("selectedScripts", JSON.stringify(selectedScripts));
        };

        let label = document.createElement("label");
        label.innerText = scriptName;
        label.style.marginLeft = "5px";

        let container = document.createElement("div");
        container.appendChild(checkbox);
        container.appendChild(label);
        menu.appendChild(container);
    });

    document.body.appendChild(menu);
}

function loadSelectedScripts(scripts) {
    let selectedScripts = JSON.parse(localStorage.getItem("selectedScripts")) || [];

    selectedScripts.forEach(scriptName => {
        if (scripts.includes(scriptName)) {
            let script = document.createElement("script");
            script.src = `https://thehierophant6.github.io/${scriptName}?` + new Date().getTime();
            document.body.appendChild(script);
            console.log("Loaded script:", scriptName);
        }
    });
}

// Run script
fetchScripts();