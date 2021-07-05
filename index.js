const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");

const app = express();

app.use(cors());
// parsing application/json
app.use(bodyParser.json()); 
// parsing application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true })); 

const port = process.env.APP_PORT || 3000;
app.listen(port, function () {
	console.log("Server is running on port " + port + "...");
	console.log(`Open http://localhost:${port} in browser`);
});

const Datastore = require('nedb-promises');

const tasks = new Datastore();
tasks.insert(require("./tasks.json"));

const links = new Datastore();
links.insert(require("./links.json"));

const resources = new Datastore();
resources.insert(require("./resources.json"));

const categories = new Datastore();
categories.insert(require("./categories.json"));

const assignments = new Datastore();
assignments.insert(require("./assignments.json"));

// client side expects obj.id while DB provides obj._id
function fixID(a){
	a.id = a._id;
	delete a._id;
	return a;
}

const taskAttributes = {
	start_date: 1, end_date: 1, text: 1, progress:2, duration: 1, parent:1, details:1, opened:2, type:1, position:2
};
function safeTaskAttributes(update, obj){
	for (const key in obj){
		const type = taskAttributes[key];
		if (type === 1) update[key] = obj[key];
		else if (type === 2) update[key] = obj[key]*1;
	}

	return update;
}

const linkAttributes= {
	target:1, source:1, type:2
};
function safeLinkAttributes(update, obj){
	for (const key in obj){
		const type = linkAttributes[key];
		if (type === 1) update[key] = obj[key];
		else if (type === 2) update[key] = obj[key]*1;
	}

	return update;
}

const assignmentAttributes= {
	task:1, resource:1, value:2
};
function safeAssignmentAttributes(update, obj){
	for (const key in obj){
		const type = assignmentAttributes[key];
		if (type === 1) update[key] = obj[key];
		else if (type === 2) update[key] = obj[key]*1;
	}

	return update;
}

async function splitTask(req){
	const parent = req.params.id;
	await tasks.update(
		{ _id: parent },
		{ $set: { type:"split" }, $max:{ duration: 1, progress: 0 } },
		{}
	);

	let sibling = 0;
	const kids = await tasks.find({ parent });
	if (!kids.length) {
		const data = await tasks.find({ _id: parent });
		const origin = data[0];
		const added = await tasks.insert({
			type: "task", 
			parent,
			text: origin.text,
			start_date: origin.start_date,
			duration: origin.duration || 1,
			progress: origin.progress || 0,
			opened: origin.opened,
			details: origin.details
		});
		sibling = fixID(added).id;
	}

	const added = await tasks.insert(safeTaskAttributes({}, req.body));

	return { id: fixID(added).id, sibling };
}

async function deleteTask(id){
	const data = await tasks.find({ parent:id });
	await Promise.all(data.map(a => deleteTask(a._id)));

	await links.remove({ $or: [
		{ source: id },
		{ target: id }
	]},{
		multi:true
	});

	await assignments.remove({ task: id },{
		multi:true
	});

	await tasks.remove({ _id: id });
}

async function getPosition(parent){
	const data = await tasks.find({ parent }).sort({ position: -1 }).limit(1);
	return data[0].position + 1;
}

async function setPosition(id, mode, parent){
	if (mode === "last") {
		const relatedPosition = await getPosition(parent);
		await tasks.update({ _id: id }, { position: relatedPosition });
	} else if (mode === "first" || mode === "") {
		await tasks.update({ $and:[ { parent: parent }, { _id: { $ne: id } } ]}, { $set:{ position: relatedPosition } });
	} else throw("not supported position mode");
}

async function sendMoveQuery(id, mode, target, parent){
	const data = await tasks.find({ _id: id });
	const basePosition = data[0].position;
	const baseParent = data[0].parent;

	let relatedParent = parent, relatedPosition = 0;
	if (relatedParent == -1) relatedParent = baseParent;

	if (mode === "before" || mode === "after") {
		const tdata = await tasks.find({ _id: target });
		relatedParent = tdata[0].parent;
		relatedPosition = tdata[0].position;

		if (mode === "after") relatedPosition += 1;
	} else if (mode === "last") {
		relatedPosition = await getPosition(parent);
	}

	// source item removing may affect target index
	if (relatedParent == baseParent && (mode === "last" || basePosition < relatedPosition)) {
		relatedPosition -= 1
	}

	// already in place
	if (relatedParent == baseParent && relatedPosition == basePosition) {
		return;
	}

	// removing from source order
	await tasks.update({ $and:[ { position: { $gt: basePosition } }, { parent: baseParent } ] }, { $inc: { position: -1 } }, { multi: true } );

	// correct target order
	await tasks.update({ $and:[ { position: { $gte: relatedPosition } }, { parent: relatedParent } ] }, { $inc: { position: 1 } }, { multi: true });

	// adding at target position
	await tasks.update({ _id: id }, { $set: { position: relatedPosition, parent: relatedParent } });
}

app.get("/tasks", async (req, res, next) => {
	try {
		const data = await tasks.find({}).sort({ position: 1, parent: 1 });
		res.send(data.map(fixID));
	} catch (err) {
		next(err);
	}
});

app.put("/tasks/:id", async (req, res, next) => {
	try {
		await tasks.update(
			{ _id: req.params.id },
			{ $set: safeTaskAttributes({}, req.body) },
			{}
		);
		res.send({});
	} catch (err) {
		next(err);
	}
});

app.put("/tasks/:id/split", async (req, res, next) => {
	try {
		const { sibling, id } = await splitTask(req);
		const response = { id };
		if (sibling) response.sibling = sibling;
		res.send(response);
	} catch (err) {
		next(err);
	}
});

app.delete("/tasks/:id", async (req, res, next) => {
	try {
		await deleteTask(req.params.id);
		res.send({});
	} catch(err){
		next(err);
	}	
});

app.post("/tasks", async (req, res, next) => {
	try {
		const data = await tasks.insert(safeTaskAttributes({
			progress:0, parent:0, text:"New Task"
		}, req.body));

		const mode = req.body.mode;
		const parent = req.body.parent;
		setPosition(data.id, mode, parent);

		res.send({ id: fixID(data).id });
	} catch(err){
		next(err);
	}
});

app.put("/tasks/:id/position", async (req, res, next) => {
	try {
		const id = req.params.id;
		const target = req.body.target;
		const parent = req.body.parent;
		const mode = req.body.mode;
		sendMoveQuery(id, mode, target, parent)

		res.send({ id });
	} catch (err) {
		next(err);
	}
});

app.get("/links", async (req, res, next) => {
	try {
		const data = await links.find({});
		res.send(data.map(fixID));
	} catch (err) {
		next(err);
	}
});

app.put("/links/:id", async (req, res, next) => {
	try {
		await links.update(
			{ _id: req.params.id },
			{ $set: safeLinkAttributes({}, req.body) },
			{}
		);
		res.send({});
	} catch (err) {
		next(err);
	}
});

app.delete("/links/:id", async (req, res, next) => {
	try {
		await links.remove({ _id: req.params.id });
		res.send({});
	} catch (err) {
		next(err);
	}
});

app.post("/links", async (req, res, next) => {
	try {
		const data = await links.insert(safeLinkAttributes({}, req.body));
		res.send({ id: fixID(data).id });
	} catch (err) {
		next(err);
	}
});

app.get("/resources", async (req, res, next) => {
	try {
		const data = await resources.find({});
		res.send(data.map(fixID));
	} catch (err) {
		next(err);
	}
});
app.get("/categories", async (req, res, next) => {
	try {
		const data = await categories.find({});
		res.send(data.map(fixID));
	} catch (err) {
		next(err);
	}
});
app.get("/assignments", async (req, res, next) => {
	try {
		const data = await assignments.find({});
		res.send(data.map(fixID));
	} catch (err) {
		next(err);
	}
});
app.put("/assignments/:id", async (req, res, next) => {
	try {
		await assignments.update(
			{ _id: req.params.id },
			{ $set: safeAssignmentAttributes({}, req.body) },
			{}
		);
		res.send({});
	} catch (err) {
		next(err);
	}
});

app.delete("/assignments/:id", async (req, res, next) => {
	try {
		await assignments.remove({ _id: req.params.id });
		res.send({});
	} catch (err) {
		next(err);
	}
});

app.post("/assignments", async (req, res, next) => {
	try {
		const data = await assignments.insert(safeAssignmentAttributes({}, req.body));
		res.send({ id: fixID(data).id });
	} catch (err) {
		next(err);
	}
});
