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

app.get("/tasks", async (req, res, next) => {
	try {
		const data = await tasks.find({});
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

app.delete("/tasks/:id", async (req, res, next) => {
	try {
		await deleteTask(req.params.id);
		res.send({});
	} catch(e){
		next(err);
	}	
});

app.post("/tasks", async (req, res, next) => {
	try {
		const data = await tasks.insert(safeTaskAttributes({
			progress:0, parent:0, text:"New Task"
		},req.body));
		res.send({ id: fixID(data).id });
	} catch(e){
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