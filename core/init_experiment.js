function initializeExperiment() {
    const prolific_id = new URLSearchParams(window.location.search).get('PROLIFIC_ID') || '';
    const jsPsychInitOptions = {
        on_finish: () => jsPsych.data.displayData()
    };

    console.log('PROLIFIC_ID:', prolific_id);
    const jsPsych = initJsPsych(jsPsychInitOptions);
    jsPsych.data.addProperties({ "PROLIFIC ID": prolific_id });
    return jsPsych;
}
