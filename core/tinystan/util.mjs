//#region src/util.ts
const prepareStanJSON = (obj) => {
	if (typeof obj === "string") return obj;
	else return JSON.stringify(obj);
};
const printCallbackSponge = () => {
	const stdoutHolder = { text: "" };
	const printCallback = (...args) => {
		const text = args.join(" ");
		stdoutHolder.text = stdoutHolder.text + text + "\n";
	};
	const getStdout = () => stdoutHolder.text;
	const clearStdout = () => stdoutHolder.text = "";
	return {
		printCallback,
		getStdout,
		clearStdout
	};
};
//#endregion
export { prepareStanJSON, printCallbackSponge };