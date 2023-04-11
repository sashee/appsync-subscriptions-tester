import ReactDOM from "react-dom";
import htm from "htm";
import React, {useState} from "react";
import {Door} from "./door.mjs";

const html = htm.bind(React.createElement);

export const App = () => {
	const [active, setActive] = useState("door");

	return html`
		<div class="container">
			<ul class="nav nav-pills justify-content-end mb-5">
				<li class="nav-item">
					<a class="nav-link ${active === "door" ? "active" : ""}" onClick=${() => setActive("door")} href="#">Door</a>
				</li>
				<li class="nav-item">
					<a class="nav-link ${active === "temperature" ? "active" : ""}" onClick=${() => setActive("temperature")} href="#">Temperature</a>
				</li>
				<li class="nav-item">
					<a class="nav-link ${active === "badges" ? "active" : ""}" onClick=${() => setActive("badges")} href="#">Badges</a>
				</li>
			</ul>
			<div>
			${active === "door" && html`
				<${Door}/>
			`}
			</div>
		</div>`;
};

ReactDOM.createRoot(document.getElementById("content")).render(html`
	<${App}
	/>
`);

